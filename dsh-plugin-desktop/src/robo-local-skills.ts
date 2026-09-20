import { constants } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { resolveOpenFoxHome } from './desktop-home-path.ts'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { isSameOriginLoopbackRequest } from './robo-skills-proxy.ts'

export const ROBO_LOCAL_SKILLS_PATH = '/api/desktop/local-skills'
export const ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH = '/api/desktop/local-skills/pick-directory'

const REGISTRY_FILENAME = '.robocoding-local-skills.json'
const MARKER_FILENAME = '.robocoding-local-import.json'
const MAX_REQUEST_BYTES = 16 * 1024
const MAX_FILES = 512
const MAX_BYTES = 16 * 1024 * 1024
const mutationQueues = new Map<string, Promise<void>>()

export interface RoboLocalSkill {
  name: string
  description: string
  path: string
  userInvocable?: boolean
}

export interface RoboLocalSkillsOptions {
  dshHome?: string
  maxFiles?: number
  maxBytes?: number
  reportError?: (cause: unknown) => void
}

interface ImportRegistry {
  version: 1
  skills: Record<string, string>
}

interface BundleEntry {
  relativePath: string
  sourcePath: string
  type: 'directory' | 'file'
  mode: number
  size: number
}

class LocalSkillRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new LocalSkillRequestError(400, 'request body is too large')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new LocalSkillRequestError(400, 'invalid JSON request')
  }
}

function requestString(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    throw new LocalSkillRequestError(400, `request requires ${key}`)
  }
  const field = (value as Record<string, unknown>)[key]
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new LocalSkillRequestError(400, `request requires ${key}`)
  }
  return field.trim()
}

function providerContext(): Context {
  return {
    get: () => undefined,
    logger: { warn: () => {} },
  } as unknown as Context
}

async function discoverSkills(root: string): Promise<RoboLocalSkill[]> {
  const lifecycle = new AbortController()
  const provider = new FileSystemSkillProvider(
    providerContext(),
    { signal: lifecycle.signal, invalidate: () => {} },
    { includeDefaultRoots: false, customSkillDirs: [root], watch: false },
  )
  try {
    const observation = await provider.list({})
    const candidates = Array.isArray(observation) ? observation : observation.candidates
    return candidates.flatMap(candidate => candidate.path === undefined ? [] : [{
      name: candidate.name,
      description: candidate.description,
      path: candidate.path,
      ...(candidate.invocation.userInvocable ? {} : { userInvocable: false }),
    }])
  } finally {
    lifecycle.abort()
    await provider.dispose()
  }
}

async function inspectBundle(source: string, maxFiles: number, maxBytes: number): Promise<BundleEntry[]> {
  if (!isAbsolute(source)) throw new LocalSkillRequestError(400, '请选择本机文件夹的绝对路径')
  let rootInfo
  try {
    rootInfo = await lstat(source)
  } catch {
    throw new LocalSkillRequestError(400, '所选技能文件夹不存在')
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new LocalSkillRequestError(400, '请选择真实的本机文件夹')
  }

  const entries: BundleEntry[] = []
  let files = 0
  let bytes = 0
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === MARKER_FILENAME) {
        throw new LocalSkillRequestError(400, `技能包不能包含保留文件 ${MARKER_FILENAME}`)
      }
      const sourcePath = join(directory, entry.name)
      const relativePath = prefix.length === 0 ? entry.name : join(prefix, entry.name)
      const info = await lstat(sourcePath)
      if (info.isSymbolicLink()) throw new LocalSkillRequestError(400, '技能包不能包含符号链接')
      if (info.isDirectory()) {
        entries.push({ relativePath, sourcePath, type: 'directory', mode: info.mode, size: 0 })
        await visit(sourcePath, relativePath)
      } else if (info.isFile()) {
        files += 1
        bytes += info.size
        if (files > maxFiles) throw new LocalSkillRequestError(400, `技能包文件数量超过限制（最多 ${String(maxFiles)} 个）`)
        if (bytes > maxBytes) throw new LocalSkillRequestError(400, `技能包大小超过限制（最多 ${String(maxBytes)} 字节）`)
        entries.push({ relativePath, sourcePath, type: 'file', mode: info.mode, size: info.size })
      } else {
        throw new LocalSkillRequestError(400, '技能包只能包含普通文件和文件夹')
      }
    }
  }
  await visit(source, '')
  if (!entries.some(entry => entry.type === 'file' && entry.relativePath === 'SKILL.md')) {
    throw new LocalSkillRequestError(400, '所选文件夹必须包含 SKILL.md')
  }
  return entries
}

async function copyRegularFile(entry: BundleEntry, destination: string): Promise<void> {
  const source = await open(entry.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const current = await source.stat()
    if (!current.isFile() || current.size !== entry.size) {
      throw new LocalSkillRequestError(400, 'skill bundle changed during import')
    }
    await writeFile(destination, await source.readFile(), { flag: 'wx', mode: entry.mode & 0o777 })
  } finally {
    await source.close()
  }
  await chmod(destination, entry.mode & 0o777)
}

async function copyBundle(entries: BundleEntry[], destination: string): Promise<void> {
  await mkdir(destination, { recursive: false, mode: 0o700 })
  for (const entry of entries.filter(value => value.type === 'directory')) {
    await mkdir(join(destination, entry.relativePath), { recursive: true, mode: entry.mode & 0o777 })
  }
  for (const entry of entries.filter(value => value.type === 'file')) {
    await copyRegularFile(entry, join(destination, entry.relativePath))
  }
}

function registryPath(dshHome: string): string {
  return join(dshHome, REGISTRY_FILENAME)
}

async function readRegistry(dshHome: string): Promise<ImportRegistry> {
  try {
    const value = JSON.parse(await readFile(registryPath(dshHome), 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1) {
      throw new Error('invalid registry')
    }
    const skills = (value as { skills?: unknown }).skills
    if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) throw new Error('invalid registry')
    const safe: Record<string, string> = {}
    for (const [name, path] of Object.entries(skills)) {
      if (typeof path === 'string') safe[name] = path
    }
    return { version: 1, skills: safe }
  } catch (cause: unknown) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') {
      return { version: 1, skills: {} }
    }
    throw new LocalSkillRequestError(500, 'local skill ownership registry is invalid')
  }
}

async function writeRegistry(dshHome: string, registry: ImportRegistry): Promise<void> {
  await mkdir(dshHome, { recursive: true })
  const target = registryPath(dshHome)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

function directChild(root: string, name: string): string {
  const target = resolve(root, name)
  const child = relative(root, target)
  if (child.length === 0 || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child) || child.includes(sep)) {
    throw new LocalSkillRequestError(400, 'invalid skill name')
  }
  return target
}

async function importSkill(directory: string, options: RoboLocalSkillsOptions): Promise<RoboLocalSkill> {
  if (!isAbsolute(directory)) throw new LocalSkillRequestError(400, '请选择本机文件夹的绝对路径')
  const source = resolve(directory)
  const maxFiles = options.maxFiles ?? MAX_FILES
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const entries = await inspectBundle(source, maxFiles, maxBytes)
  const sourceSkills = await discoverSkills(dirname(source))
  const skillFile = join(source, 'SKILL.md')
  const sourceSkill = sourceSkills.find(skill => resolve(skill.path) === skillFile)
  if (sourceSkill === undefined) throw new LocalSkillRequestError(400, 'SKILL.md 不是有效的本地技能')

  const dshHome = options.dshHome === undefined ? resolveOpenFoxHome() : options.dshHome
  const skillsRoot = join(dshHome, 'skills')
  const destination = directChild(skillsRoot, sourceSkill.name)
  try {
    await stat(destination)
    throw new LocalSkillRequestError(409, `技能“${sourceSkill.name}”已存在`)
  } catch (cause: unknown) {
    if (cause instanceof LocalSkillRequestError) throw cause
    if (!(typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT')) throw cause
  }

  await mkdir(skillsRoot, { recursive: true })
  const registry = await readRegistry(dshHome)
  const staging = join(skillsRoot, `.robocoding-import-${randomUUID()}`)
  try {
    await copyBundle(entries, staging)
    const staged = (await discoverSkills(skillsRoot)).find(skill => resolve(skill.path) === join(staging, 'SKILL.md'))
    if (staged === undefined || staged.name !== sourceSkill.name || staged.description !== sourceSkill.description) {
      throw new LocalSkillRequestError(400, '复制后的技能未通过本地技能校验')
    }
    await writeFile(join(staging, MARKER_FILENAME), `${JSON.stringify({ version: 1, name: sourceSkill.name })}\n`, { mode: 0o600 })
    await rename(staging, destination)
    registry.skills[sourceSkill.name] = destination
    try {
      await writeRegistry(dshHome, registry)
    } catch (cause: unknown) {
      await rm(destination, { recursive: true, force: true })
      throw cause
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return { ...sourceSkill, path: join(destination, 'SKILL.md') }
}

async function serializeMutation<T>(dshHome: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(dshHome) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(operation)
  const settled = run.then(() => {}, () => {})
  mutationQueues.set(dshHome, settled)
  try {
    return await run
  } finally {
    if (mutationQueues.get(dshHome) === settled) mutationQueues.delete(dshHome)
  }
}

async function deleteSkill(name: string, options: RoboLocalSkillsOptions): Promise<void> {
  const dshHome = options.dshHome === undefined ? resolveOpenFoxHome() : options.dshHome
  const skillsRoot = join(dshHome, 'skills')
  const destination = directChild(skillsRoot, name)
  const registry = await readRegistry(dshHome)
  if (registry.skills[name] !== destination) throw new LocalSkillRequestError(404, 'skill is not managed by local import')
  const destinationInfo = await lstat(destination).catch(() => undefined)
  if (destinationInfo === undefined || destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory()) {
    throw new LocalSkillRequestError(409, 'managed skill directory is missing or unsafe')
  }
  let marker: unknown
  try {
    marker = JSON.parse(await readFile(join(destination, MARKER_FILENAME), 'utf8')) as unknown
  } catch {
    throw new LocalSkillRequestError(409, 'skill ownership marker is missing')
  }
  if (typeof marker !== 'object' || marker === null
    || (marker as { version?: unknown }).version !== 1
    || (marker as { name?: unknown }).name !== name) {
    throw new LocalSkillRequestError(409, 'skill ownership marker is invalid')
  }
  const tombstone = join(skillsRoot, `.robocoding-delete-${randomUUID()}`)
  await rename(destination, tombstone)
  delete registry.skills[name]
  try {
    await writeRegistry(dshHome, registry)
  } catch (cause: unknown) {
    await rename(tombstone, destination)
    throw cause
  }
  await rm(tombstone, { recursive: true })
}

/** Serve local-only skill discovery, folder import, and owned-import deletion. */
export async function handleRoboLocalSkillsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  options: RoboLocalSkillsOptions = {},
): Promise<void> {
  const method = req.method ?? 'GET'
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, method !== 'GET')) {
    return finishJson(res, 403, { error: 'forbidden' })
  }
  try {
    const dshHome = options.dshHome === undefined ? resolveOpenFoxHome() : options.dshHome
    if (req.method === 'GET') {
      const registry = await readRegistry(dshHome)
      const skills = (await discoverSkills(join(dshHome, 'skills'))).filter(
        skill => registry.skills[skill.name] === dirname(skill.path),
      )
      return finishJson(res, 200, { skills })
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      res.setHeader('allow', 'GET, POST, DELETE')
      return finishJson(res, 405, { error: 'method not allowed' })
    }
    if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return finishJson(res, 415, { error: 'content type must be application/json' })
    }
    const body = await readJson(req)
    if (req.method === 'POST') {
      const skill = await serializeMutation(dshHome, async () => await importSkill(requestString(body, 'directory'), options))
      return finishJson(res, 201, { skill })
    }
    await serializeMutation(dshHome, async () => await deleteSkill(requestString(body, 'name'), options))
    finishJson(res, 200, { deleted: true })
  } catch (cause: unknown) {
    if (cause instanceof LocalSkillRequestError) return finishJson(res, cause.statusCode, { error: cause.message })
    options.reportError?.(cause)
    finishJson(res, 500, { error: 'local skill operation failed' })
  }
}

/** Open the native skill-folder chooser for the local skills screen. */
export async function handleRoboLocalSkillPickerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  pickDirectory: () => Promise<string | null>,
  reportError: (cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (req.headers.origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
  try {
    finishJson(res, 200, { path: await pickDirectory() })
  } catch (cause: unknown) {
    reportError(cause)
    finishJson(res, 500, { error: 'native skill directory picker failed' })
  }
}

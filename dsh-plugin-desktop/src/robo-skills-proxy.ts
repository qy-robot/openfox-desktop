/** Local-only proxy between the Desktop renderer and RoboCoding skills service. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { publicDeviceDetails, publicPublisher } from './robo-catalog-metadata.ts'

/** Renderer endpoint for the local skill catalog. */
export const ROBO_SKILLS_CATALOG_PATH = '/api/desktop/robo-skills/catalog'

/** Renderer endpoint for the independently published device catalog. */
export const ROBO_DEVICES_CATALOG_PATH = '/api/desktop/robo-skills/devices'

/** Renderer endpoint for local demonstration runs. */
export const ROBO_SKILLS_DEMO_RUNS_PATH = '/api/desktop/robo-skills/demo-runs'

/** Renderer endpoint for the guarded, structured Bumi run protocol. */
export const ROBO_SKILLS_RUNS_PATH = '/api/desktop/robo-skills/runs'

const CATALOG_UPSTREAM_PATH = '/v1/catalog'
const DEMO_RUNS_UPSTREAM_PATH = '/v1/demo-runs'
const RUNS_UPSTREAM_PATH = '/v1/runs'
const MAX_REQUEST_BODY_BYTES = 64 * 1024
const MAX_CATALOG_RESPONSE_BYTES = 1024 * 1024
const MAX_DEMO_RESPONSE_BYTES = 64 * 1024
const MAX_DETAILS_OVERVIEW_LENGTH = 4_096
const MAX_DETAILS_LIST_ITEMS = 20
const MAX_DETAILS_ITEM_LENGTH = 2_048
const UPSTREAM_TIMEOUT_MS = 5_000

class BodyTooLargeError extends Error {}
class InvalidServiceUrlError extends Error {}
class ResponseTooLargeError extends Error {}
class UpstreamResponseError extends Error {
  constructor(readonly status: number) {
    super('upstream rejected request')
  }
}

interface RoboSkillDemoRequest {
  readonly skillId: string
  readonly skillVersion: string
  readonly modelId?: string
  readonly profileId?: string
  readonly text: string
}

interface RoboSkillRunRequest {
  readonly skillId: string
  readonly skillVersion: string
  readonly input: Record<string, unknown>
}

export interface RoboSkillsProxyOptions {
  /** Local service URL read from `ROBO_SKILLS_URL` by the Desktop Host. */
  readonly serviceUrl?: string | undefined
  /** Timeout override used by focused tests. */
  readonly catalogUrl?: string | undefined
  readonly timeoutMs?: number
  /** HTTP implementation override used by focused tests. */
  readonly fetch?: typeof globalThis.fetch
}

function finishJson(
  res: ServerResponse,
  statusCode: number,
  value: object,
  allow?: 'GET' | 'POST',
): void {
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(Buffer.byteLength(body)))
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(body)
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1') return true
  if (address.startsWith('::ffff:')) return address.slice('::ffff:'.length).startsWith('127.')
  return address.startsWith('127.')
}

function expectedLoopbackOrigin(expectedOrigin: string): URL | undefined {
  try {
    const url = new URL(expectedOrigin)
    if (url.origin !== expectedOrigin || url.protocol !== 'http:'
      || url.username !== '' || url.password !== ''
      || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')) return undefined
    return url
  } catch {
    return undefined
  }
}

function exactHeaderOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return url.origin === value ? value : undefined
  } catch {
    return undefined
  }
}

function referrerOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

export function isSameOriginLoopbackRequest(
  req: IncomingMessage,
  expectedOrigin: string,
  mutating: boolean,
): boolean {
  const expected = expectedLoopbackOrigin(expectedOrigin)
  if (expected === undefined || !isLoopbackAddress(req.socket.remoteAddress)) return false
  if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false
  if (exactHeaderOrigin(req.headers.origin) === expected.origin) {
    return req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin'
  }
  if (mutating) return false
  return req.headers['sec-fetch-site'] === 'same-origin'
    && referrerOrigin(req.headers.referer) === expected.origin
}

function localServiceOrigin(value: string | undefined): URL | undefined {
  if (value === undefined || value === '') return undefined
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost):([0-9]{1,5})\/?$/i.exec(value)
  if (match === null) throw new InvalidServiceUrlError()
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new InvalidServiceUrlError()
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.port === ''
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new InvalidServiceUrlError()
  }
  return url
}

function isJsonRequest(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readRequestJson(req: IncomingMessage): Promise<unknown> {
  const declaredLength = req.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) throw new SyntaxError('invalid content length')
    if (Number(declaredLength) > MAX_REQUEST_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_REQUEST_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseDemoRequest(value: unknown): RoboSkillDemoRequest | undefined {
  if (!isRecord(value)) return undefined
  const allowed = new Set(['skillId', 'skillVersion', 'modelId', 'profileId', 'text'])
  if (Object.keys(value).some(key => !allowed.has(key))) return undefined
  if (!nonEmptyString(value.skillId) || !nonEmptyString(value.skillVersion)
    || typeof value.text !== 'string') return undefined
  if (value.modelId !== undefined && !nonEmptyString(value.modelId)) return undefined
  if (value.profileId !== undefined && !nonEmptyString(value.profileId)) return undefined
  return {
    skillId: value.skillId,
    skillVersion: value.skillVersion,
    ...(value.modelId === undefined ? {} : { modelId: value.modelId }),
    ...(value.profileId === undefined ? {} : { profileId: value.profileId }),
    text: value.text,
  }
}

function parseRunRequest(value: unknown): RoboSkillRunRequest | undefined {
  if (!isRecord(value) || Object.keys(value).some(key => !['skillId', 'skillVersion', 'input'].includes(key))
    || !nonEmptyString(value.skillId) || !nonEmptyString(value.skillVersion) || !isRecord(value.input)) return undefined
  return { skillId: value.skillId, skillVersion: value.skillVersion, input: value.input }
}

async function readBoundedResponse(response: Response, limit: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit) {
      throw new ResponseTooLargeError()
    }
  }
  if (response.body === null) throw new SyntaxError('missing response body')
  const reader = response.body.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new ResponseTooLargeError()
      chunks.push(value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => {})
    throw cause
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

function hasStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isBoundedDetailsList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_DETAILS_LIST_ITEMS
    && value.every(item => nonEmptyString(item) && item.length <= MAX_DETAILS_ITEM_LENGTH)
}

function projectSkillDetails(value: unknown): object | undefined {
  if (!isRecord(value)
    || !nonEmptyString(value.overview) || value.overview.length > MAX_DETAILS_OVERVIEW_LENGTH) return undefined
  const fields = ['inputs', 'outputs', 'limitations'] as const
  if (fields.some(field => !isBoundedDetailsList(value[field]))) return undefined
  return {
    overview: value.overview,
    inputs: value.inputs,
    outputs: value.outputs,
    limitations: value.limitations,
  }
}

function projectComponents(value: unknown): object | undefined {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.keys(value).length > 100) return undefined
  const result: Record<string, object> = {}
  for (const [id, item] of Object.entries(value)) {
    if (!nonEmptyString(id) || id.length > 128 || !isRecord(item)
      || !nonEmptyString(item.version) || item.version.length > 128
      || (item.scheme !== undefined && item.scheme !== 'exact' && item.scheme !== 'semver')) return undefined
    result[id] = { version: item.version, ...(item.scheme === undefined ? {} : { scheme: item.scheme }) }
  }
  return result
}

function projectCompatibilityScope(value: unknown): object | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === 'all') return { kind: 'all' }
  if (value.kind === 'series' && hasStringArray(value.seriesIds) && value.seriesIds.length > 0
    && value.seriesIds.every(nonEmptyString)) return { kind: 'series', seriesIds: value.seriesIds }
  if (value.kind === 'models' && hasStringArray(value.modelIds) && value.modelIds.length > 0
    && value.modelIds.every(nonEmptyString)) return { kind: 'models', modelIds: value.modelIds }
  if (value.kind === 'profiles' && Array.isArray(value.targets) && value.targets.length > 0
    && value.targets.every(target => isRecord(target) && nonEmptyString(target.modelId) && nonEmptyString(target.profileId))) {
    return { kind: 'profiles', targets: value.targets.map(target => ({ modelId: (target as Record<string, unknown>).modelId, profileId: (target as Record<string, unknown>).profileId })) }
  }
  return undefined
}

function projectCompatibilityRequirement(value: unknown): object | undefined {
  if (!isRecord(value) || !nonEmptyString(value.componentId)
    || (value.scheme !== 'exact' && value.scheme !== 'semver')) return undefined
  if (value.operator === 'exact' && nonEmptyString(value.value)) {
    return { componentId: value.componentId, scheme: value.scheme, operator: 'exact', value: value.value }
  }
  if (value.operator === 'in' && hasStringArray(value.values) && value.values.length > 0 && value.values.every(nonEmptyString)) {
    return { componentId: value.componentId, scheme: value.scheme, operator: 'in', values: value.values }
  }
  if (value.operator === 'range' && value.scheme === 'semver'
    && (nonEmptyString(value.min) || nonEmptyString(value.max))) {
    return { componentId: value.componentId, scheme: 'semver', operator: 'range',
      ...(nonEmptyString(value.min) ? { min: value.min } : {}), minInclusive: value.minInclusive === true,
      ...(nonEmptyString(value.max) ? { max: value.max } : {}), maxInclusive: value.maxInclusive === true,
      allowPrerelease: value.allowPrerelease === true }
  }
  return undefined
}

function projectCompatibilityRule(value: unknown): object | undefined {
  if (!isRecord(value)) return undefined
  const scope = projectCompatibilityScope(value.scope)
  const rawRequirements = value.requirements ?? []
  if (!scope || !Array.isArray(rawRequirements) || rawRequirements.length > 100) return undefined
  const requirements = rawRequirements.map(projectCompatibilityRequirement)
  return requirements.some(item => item === undefined) ? undefined : { scope, requirements }
}

function projectCompatibility(value: unknown): object | undefined {
  if (!isRecord(value) || value.compatibilitySchemaVersion !== 2 || !Array.isArray(value.rules)
    || value.rules.length === 0 || value.rules.length > 100) return undefined
  const rules = value.rules.map(projectCompatibilityRule)
  const rawExclusions = value.exclusions ?? []
  const rawTested = value.testedTargets ?? []
  if (rules.some(item => item === undefined) || !Array.isArray(rawExclusions) || rawExclusions.length > 100
    || !Array.isArray(rawTested) || rawTested.length > 500) return undefined
  const exclusions = rawExclusions.map(projectCompatibilityRule)
  if (exclusions.some(item => item === undefined)) return undefined
  const testedTargets = rawTested.map(item => {
    if (!isRecord(item) || !nonEmptyString(item.modelId) || !nonEmptyString(item.profileId)
      || (item.result !== 'passed' && item.result !== 'failed') || !nonEmptyString(item.testedAt)) return undefined
    return { modelId: item.modelId, profileId: item.profileId, result: item.result, testedAt: item.testedAt }
  })
  if (testedTargets.some(item => item === undefined)) return undefined
  return { compatibilitySchemaVersion: 2, rules, exclusions, testedTargets }
}

function projectCatalog(value: unknown): object | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || (value.mode !== 'local-demo' && value.mode !== 'catalog')
    || !Array.isArray(value.categories) || !Array.isArray(value.robots)
    || !Array.isArray(value.skills)) return undefined
  const categoriesValid = value.categories.every(category => isRecord(category)
    && nonEmptyString(category.id) && nonEmptyString(category.name)
    && (category.visible === undefined || typeof category.visible === 'boolean'))
  const robotsValid = value.robots.every(robot => isRecord(robot)
    && nonEmptyString(robot.id) && nonEmptyString(robot.displayName)
    && nonEmptyString(robot.manufacturer) && nonEmptyString(robot.family)
    && (robot.model === undefined || nonEmptyString(robot.model))
    && (robot.seriesId === undefined || nonEmptyString(robot.seriesId)) && Array.isArray(robot.profiles)
    && robot.profiles.every(profile => isRecord(profile)
      && nonEmptyString(profile.id) && nonEmptyString(profile.label)
      && projectComponents(profile.components) !== undefined))
  const skillsValid = value.skills.every(skill => isRecord(skill)
    && nonEmptyString(skill.id) && nonEmptyString(skill.displayName)
    && (typeof skill.summary === 'string' || typeof skill.description === 'string') && nonEmptyString(skill.version)
    && nonEmptyString(skill.category) && typeof skill.robotIndependent === 'boolean'
    && typeof skill.demo === 'boolean' && skill.demo === (value.mode === 'local-demo')
    && (skill.execution === undefined || skill.execution === 'local-demo' || skill.execution === 'local-readonly' || skill.execution === 'server')
    && (value.mode === 'local-demo'
      ? (skill.execution === undefined || skill.execution === 'local-demo')
      : skill.execution !== 'local-demo') && Array.isArray(skill.targets)
    && skill.targets.every(target => isRecord(target)
      && nonEmptyString(target.modelId) && hasStringArray(target.profileIds))
    && (skill.details === undefined || projectSkillDetails(skill.details) !== undefined)
    && (skill.compatibility === undefined || projectCompatibility(skill.compatibility) !== undefined))
  const marketRevisionValid = value.marketRevision === undefined
    || (Number.isSafeInteger(value.marketRevision) && (value.marketRevision as number) >= 0)
  const featuredSkillIdsValid = value.featuredSkillIds === undefined
    || (hasStringArray(value.featuredSkillIds)
      && new Set(value.featuredSkillIds).size === value.featuredSkillIds.length
      && value.featuredSkillIds.every(id => (value.skills as unknown[])
        .some(skill => isRecord(skill) && skill.id === id)))
  if (!categoriesValid || !robotsValid || !skillsValid || !marketRevisionValid || !featuredSkillIdsValid) return undefined
  return {
    schemaVersion: 1,
    mode: value.mode,
    ...(value.marketRevision === undefined ? {} : { marketRevision: value.marketRevision }),
    featuredSkillIds: value.featuredSkillIds ?? [],
    categories: value.categories.map(category => ({
      id: category.id,
      name: category.name,
      visible: category.visible ?? true,
    })),
    robots: value.robots.map(robot => ({
      id: robot.id,
      displayName: robot.displayName,
      manufacturer: robot.manufacturer,
      ...(robot.model === undefined ? {} : { model: robot.model }),
      family: robot.family,
      ...(robot.seriesId === undefined ? {} : { seriesId: robot.seriesId }),
      ...publicDeviceDetails(robot),
      profiles: (robot.profiles as Record<string, unknown>[]).map(profile => ({
        id: profile.id,
        label: profile.label,
        ...(profile.components === undefined ? {} : { components: projectComponents(profile.components) }),
      })),
    })),
    skills: value.skills.map(skill => {
      const details = skill.details === undefined ? undefined : projectSkillDetails(skill.details)
      const compatibility = skill.compatibility === undefined ? undefined : projectCompatibility(skill.compatibility)
      return {
        id: skill.id,
        displayName: skill.displayName,
        description: typeof skill.description === 'string' ? skill.description : skill.summary,
        summary: typeof skill.summary === 'string' ? skill.summary : skill.description,
        version: skill.version,
        category: skill.category,
        robotIndependent: skill.robotIndependent,
        targets: (skill.targets as Record<string, unknown>[]).map(target => ({
          modelId: target.modelId,
          profileIds: target.profileIds,
        })),
        demo: skill.demo,
        ...(skill.execution === undefined ? {} : { execution: skill.execution }),
        ...(skill.publisher === undefined ? {} : { publisher: publicPublisher(skill.publisher) }),
        ...(details === undefined ? {} : { details }),
        ...(compatibility === undefined ? {} : { compatibility }),
      }
    }),
  }
}

function projectDeviceCatalog(value: unknown): object | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || (value.mode !== 'local-demo' && value.mode !== 'catalog')
    || !Array.isArray(value.robots)) return undefined
  return projectCatalog({ ...value, categories: value.categories ?? [], skills: value.skills ?? [] })
}

function projectDemoResponse(value: unknown): object | undefined {
  const valid = isRecord(value) && value.mode === 'local-demo'
    && nonEmptyString(value.skillId) && nonEmptyString(value.skillVersion)
    && typeof value.summary === 'string' && value.demo === true
    && Array.isArray(value.findings)
    && value.findings.every(finding => isRecord(finding)
      && (finding.level === 'info' || finding.level === 'warning')
      && typeof finding.message === 'string')
  if (!valid) return undefined
  return {
    mode: 'local-demo',
    skillId: value.skillId,
    skillVersion: value.skillVersion,
    summary: value.summary,
    findings: (value.findings as Record<string, unknown>[]).map(finding => ({
      level: finding.level,
      message: finding.message,
    })),
    demo: true,
  }
}

function projectBumiRunResponse(value: unknown): object | undefined {
  if (!isRecord(value) || value.mode !== 'local-demo' || value.demo !== true
    || !nonEmptyString(value.skillId) || !nonEmptyString(value.skillVersion) || !isRecord(value.output)) return undefined
  const output = value.output
  const status = output.status
  if (status !== 'ready-for-review' && status !== 'ready-for-authorized-validation'
    && status !== 'needs-investigation' && status !== 'blocked') return undefined
  if (!nonEmptyString(output.summary) || !Array.isArray(output.findings) || output.findings.length < 1 || output.findings.length > 20
    || !Array.isArray(output.filePatchProposals) || output.filePatchProposals.length > 10
    || !Array.isArray(output.commandProposals) || output.commandProposals.length > 10
    || !Array.isArray(output.deviceOperationProposals) || output.deviceOperationProposals.length > 5
    || !Array.isArray(output.safetyNotes) || output.safetyNotes.length < 1 || output.safetyNotes.length > 10) return undefined
  const finding = (item: unknown): object | undefined => {
    if (!isRecord(item) || !['environment', 'python', 'cpp', 'dds', 'vision', 'deployment', 'motion-safety', 'documentation'].includes(String(item.area))
      || !['observed', 'needs-confirmation', 'risk', 'blocked'].includes(String(item.level))
      || !nonEmptyString(item.message) || !nonEmptyString(item.evidence)) return undefined
    return { area: item.area, level: item.level, message: item.message, evidence: item.evidence }
  }
  const proposal = (item: unknown, fields: readonly string[]): object | undefined => {
    if (!isRecord(item) || fields.some(field => !nonEmptyString(item[field])) || item.approvalRequired !== true) return undefined
    return Object.fromEntries([...fields.map(field => [field, item[field]]), ['approvalRequired', true]])
  }
  const filePatchProposals = output.filePatchProposals.map(item => proposal(item, ['targetPath', 'purpose', 'changeSummary']))
  const commandProposals = output.commandProposals.map(item => proposal(item, ['command', 'purpose', 'expectedResult', 'stopCondition']))
  const deviceOperationProposals = output.deviceOperationProposals.map(item => {
    if (!isRecord(item) || !['ssh-readonly-check', 'file-transfer-plan', 'dds-connectivity-check', 'camera-validation', 'motion-capable-run'].includes(String(item.operation))
      || !nonEmptyString(item.purpose) || !Array.isArray(item.preconditions) || item.preconditions.length < 1
      || item.preconditions.some(item => !nonEmptyString(item)) || !nonEmptyString(item.stopCondition) || item.approvalRequired !== true) return undefined
    return { operation: item.operation, purpose: item.purpose, preconditions: item.preconditions, stopCondition: item.stopCondition, approvalRequired: true }
  })
  if (output.findings.some(item => finding(item) === undefined) || filePatchProposals.some(item => item === undefined)
    || commandProposals.some(item => item === undefined) || deviceOperationProposals.some(item => item === undefined)
    || output.safetyNotes.some(item => !nonEmptyString(item))) return undefined
  return {
    mode: 'local-demo', demo: true, skillId: value.skillId, skillVersion: value.skillVersion,
    output: {
      status, summary: output.summary, findings: output.findings.map(finding),
      filePatchProposals, commandProposals, deviceOperationProposals, safetyNotes: output.safetyNotes,
    },
  }
}

async function requestLocalService(
  url: URL,
  method: 'GET' | 'POST',
  body: RoboSkillDemoRequest | RoboSkillRunRequest | undefined,
  responseLimit: number,
  options: RoboSkillsProxyOptions,
): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? UPSTREAM_TIMEOUT_MS)
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      method,
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new UpstreamResponseError(response.status)
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') throw new SyntaxError('upstream did not return JSON')
    return await readBoundedResponse(response, responseLimit)
  } catch (cause) {
    if (timedOut) throw new DOMException('request timed out', 'TimeoutError')
    throw cause
  } finally {
    clearTimeout(timeout)
  }
}

function fixedUpstreamUrl(base: URL, path: string): URL {
  const target = new URL(base.origin)
  target.pathname = path
  return target
}

/** Serve one authenticated, same-origin renderer request through the local skills service. */
export async function handleRoboSkillsProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  routePath: typeof ROBO_SKILLS_CATALOG_PATH | typeof ROBO_DEVICES_CATALOG_PATH | typeof ROBO_SKILLS_DEMO_RUNS_PATH | typeof ROBO_SKILLS_RUNS_PATH,
  options: RoboSkillsProxyOptions = {},
): Promise<void> {
  const method = routePath === ROBO_SKILLS_DEMO_RUNS_PATH || routePath === ROBO_SKILLS_RUNS_PATH ? 'POST' : 'GET'
  if (req.url !== routePath) return finishJson(res, 404, { error: 'not found' })
  if (req.method !== method) return finishJson(res, 405, { error: 'method not allowed' }, method)
  if (!isSameOriginLoopbackRequest(req, expectedOrigin, method === 'POST')) {
    return finishJson(res, 403, { error: 'forbidden' })
  }

  let base: URL | undefined
  let remoteCatalog = false
  try {
    base = localServiceOrigin(options.serviceUrl)
    if (base === undefined && method === 'GET' && options.catalogUrl) {
      // Only the fixed first-party public endpoint is accepted; renderer input cannot change it.
      if (options.catalogUrl !== 'https://api.openzrob.com/api/catalog') throw new InvalidServiceUrlError()
      base = new URL(routePath === ROBO_DEVICES_CATALOG_PATH
        ? 'https://api.openzrob.com/api/catalog/devices'
        : options.catalogUrl)
      remoteCatalog = true
    }
  } catch (cause) {
    if (!(cause instanceof InvalidServiceUrlError)) throw cause
    return finishJson(res, 503, { error: 'local skills service configuration is invalid' })
  }
  if (base === undefined) {
    return finishJson(res, 503, { error: 'local skills service is not configured' })
  }

  let requestBody: RoboSkillDemoRequest | RoboSkillRunRequest | undefined
  if (method === 'POST') {
    if (!isJsonRequest(req)) {
      return finishJson(res, 415, { error: 'content type must be application/json' })
    }
    let value: unknown
    try {
      value = await readRequestJson(req)
    } catch (cause) {
      return finishJson(res, cause instanceof BodyTooLargeError ? 413 : 400, {
        error: cause instanceof BodyTooLargeError ? 'request body is too large' : 'invalid JSON request',
      })
    }
    requestBody = routePath === ROBO_SKILLS_RUNS_PATH ? parseRunRequest(value) : parseDemoRequest(value)
    if (requestBody === undefined) {
        return finishJson(res, 400, { error: routePath === ROBO_SKILLS_RUNS_PATH ? 'invalid skill run request' : 'invalid skill demonstration request' })
    }
  }

  try {
    const value = await requestLocalService(
      remoteCatalog ? base : fixedUpstreamUrl(base, method === 'GET' ? CATALOG_UPSTREAM_PATH : routePath === ROBO_SKILLS_RUNS_PATH ? RUNS_UPSTREAM_PATH : DEMO_RUNS_UPSTREAM_PATH),
      method,
      requestBody,
      method === 'GET' ? MAX_CATALOG_RESPONSE_BYTES : MAX_DEMO_RESPONSE_BYTES,
      options,
    )
    const projected = routePath === ROBO_SKILLS_CATALOG_PATH ? projectCatalog(value)
      : routePath === ROBO_DEVICES_CATALOG_PATH ? projectDeviceCatalog(value)
      : routePath === ROBO_SKILLS_RUNS_PATH ? projectBumiRunResponse(value) : projectDemoResponse(value)
    if (projected === undefined) {
      return finishJson(res, 502, { error: 'local skills service returned an invalid response' })
    }
    finishJson(res, 200, projected)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      return finishJson(res, 504, { error: 'local skills service timed out' })
    }
    if (cause instanceof ResponseTooLargeError) {
      return finishJson(res, 502, { error: 'local skills service response is too large' })
    }
    if (remoteCatalog && cause instanceof UpstreamResponseError && cause.status === 404) {
      return finishJson(res, 503, { error: routePath === ROBO_DEVICES_CATALOG_PATH
        ? 'public device catalog is not published'
        : 'public skills catalog is not published' })
    }
    if (method === 'POST' && cause instanceof UpstreamResponseError
      && (cause.status === 400 || cause.status === 404
        || cause.status === 409 || cause.status === 413)) {
      return finishJson(res, cause.status, { error: 'local skills service rejected the request' })
    }
    finishJson(res, 502, { error: 'local skills service is unavailable' })
  }
}

/** Limits enforced by the Desktop skills proxy. */
export const roboSkillsProxyLimits = {
  maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
  maxCatalogResponseBytes: MAX_CATALOG_RESPONSE_BYTES,
  maxDemoResponseBytes: MAX_DEMO_RESPONSE_BYTES,
  upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
} as const

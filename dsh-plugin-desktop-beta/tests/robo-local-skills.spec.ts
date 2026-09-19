import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleRoboLocalSkillPickerRequest,
  handleRoboLocalSkillsRequest,
  ROBO_LOCAL_SKILLS_PATH,
  ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH,
  type RoboLocalSkillsOptions,
} from '../src/robo-local-skills.ts'

const temporaryDirectories = new Set<string>()
const servers = new Set<Server>()

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'robo-local-skills-'))
  temporaryDirectories.add(directory)
  return directory
}

async function listen(server: Server): Promise<string> {
  servers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind TCP')
  return `http://127.0.0.1:${String(address.port)}`
}

async function startSkillsServer(dshHome: string, options: Omit<RoboLocalSkillsOptions, 'dshHome'> = {}): Promise<string> {
  let origin = ''
  const server = createServer((req, res) => {
    void handleRoboLocalSkillsRequest(req, res, origin, { dshHome, ...options })
  })
  origin = await listen(server)
  return origin
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  servers.delete(server)
}

afterEach(async () => {
  await Promise.all([...servers].map(stop))
  await Promise.all([...temporaryDirectories].map(directory => rm(directory, { recursive: true, force: true })))
  temporaryDirectories.clear()
})

async function createBundle(
  root: string,
  name = 'camera-check',
  description = 'Inspect a camera image',
  userInvocable = true,
): Promise<string> {
  const bundle = join(root, 'selected-folder')
  await mkdir(join(bundle, 'references'), { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${userInvocable ? '' : 'user-invocable: false\n'}---\n\nFollow the local checklist.\n`)
  await writeFile(join(bundle, 'references', 'checklist.md'), '# Checklist\n\nKeep this resource.\n')
  return bundle
}

describe('OpenFox local skill folder import', () => {
  it('copies a valid bundle with resources and exposes it through filesystem discovery', async () => {
    const root = await temporaryDirectory()
    const source = await createBundle(root, 'camera-check', 'Inspect a camera image', false)
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)

    const imported = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: source }),
    })

    expect(imported.status).toBe(201)
    expect(await imported.json()).toEqual({
      skill: {
        name: 'camera-check',
        description: 'Inspect a camera image',
        path: join(dshHome, 'skills', 'camera-check', 'SKILL.md'),
        userInvocable: false,
      },
    })
    expect(await readFile(join(dshHome, 'skills', 'camera-check', 'references', 'checklist.md'), 'utf8'))
      .toContain('Keep this resource')

    const listed = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, { headers: { origin } })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ skills: [{
      name: 'camera-check',
      description: 'Inspect a camera image',
      path: join(dshHome, 'skills', 'camera-check', 'SKILL.md'),
      userInvocable: false,
    }] })

    const browserGet = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      headers: { referer: `${origin}/skills`, 'sec-fetch-site': 'same-origin' },
    })
    expect(browserGet.status).toBe(200)
    expect((await browserGet.json() as { skills: Array<{ name: string }> }).skills.map(skill => skill.name))
      .toEqual(['camera-check'])
    const foreignGet = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      headers: { referer: 'https://attacker.example/skills', 'sec-fetch-site': 'same-origin' },
    })
    expect(foreignGet.status).toBe(403)
  })

  it('refuses duplicate destinations without replacing the first import', async () => {
    const root = await temporaryDirectory()
    const source = await createBundle(root)
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)
    const importRequest = () => fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: source }),
    })

    expect((await importRequest()).status).toBe(201)
    const secondRoot = join(root, 'second')
    await mkdir(secondRoot)
    const duplicateSource = await createBundle(secondRoot, 'camera-check', 'Replacement description')
    const duplicate = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: duplicateSource }),
    })

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: '技能“camera-check”已存在' })
    expect(await readFile(join(dshHome, 'skills', 'camera-check', 'SKILL.md'), 'utf8')).toContain('Inspect a camera image')
  })

  it('rejects malformed bundles, relative paths, and symbolic-link entries', async () => {
    const root = await temporaryDirectory()
    const malformed = join(root, 'malformed')
    await mkdir(malformed)
    await writeFile(join(malformed, 'SKILL.md'), '# no frontmatter')
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)
    const post = async (directory: string): Promise<Response> => await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory }),
    })

    expect(await (await post(relative(process.cwd(), malformed))).json()).toEqual({ error: '请选择本机文件夹的绝对路径' })
    expect(await (await post(malformed)).json()).toEqual({ error: 'SKILL.md 不是有效的本地技能' })

    const missing = join(root, 'missing-skill-file')
    await mkdir(missing)
    expect(await (await post(missing)).json()).toEqual({ error: '所选文件夹必须包含 SKILL.md' })

    const linked = await createBundle(root, 'linked-skill')
    await symlink(join(linked, 'SKILL.md'), join(linked, 'references', 'linked.md'))
    expect(await (await post(linked)).json()).toEqual({ error: '技能包不能包含符号链接' })
  })

  it('enforces bounded file counts before copying a bundle', async () => {
    const root = await temporaryDirectory()
    const source = await createBundle(root)
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome, { maxFiles: 1 })

    const response = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory: source }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '技能包文件数量超过限制（最多 1 个）' })
    await expect(readFile(join(dshHome, 'skills', 'camera-check', 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces the renderer origin before touching the selected folder', async () => {
    const root = await temporaryDirectory()
    const source = await createBundle(root)
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)

    const response = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ directory: source }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'forbidden' })
    await expect(readFile(join(dshHome, 'skills', 'camera-check', 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes concurrent imports so ownership records retain both skills', async () => {
    const root = await temporaryDirectory()
    const firstRoot = join(root, 'first')
    const secondRoot = join(root, 'second')
    await mkdir(firstRoot)
    await mkdir(secondRoot)
    const first = await createBundle(firstRoot, 'first-skill', 'First skill')
    const second = await createBundle(secondRoot, 'second-skill', 'Second skill')
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)
    const post = async (directory: string): Promise<Response> => await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ directory }),
    })

    const responses = await Promise.all([post(first), post(second)])
    expect(responses.map(response => response.status)).toEqual([201, 201])
    const listed = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, { headers: { origin } })
    const body = await listed.json() as { skills: Array<{ name: string }> }
    expect(body.skills.map(skill => skill.name).sort()).toEqual(['first-skill', 'second-skill'])
  })

  it('deletes only folders recorded and marked by this importer', async () => {
    const root = await temporaryDirectory()
    const source = await createBundle(root)
    const dshHome = join(root, 'dsh-home')
    const origin = await startSkillsServer(dshHome)
    await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ directory: source }),
    })
    const unmanaged = join(dshHome, 'skills', 'unmanaged')
    await mkdir(unmanaged)
    await writeFile(join(unmanaged, 'SKILL.md'), '---\nname: unmanaged\ndescription: Existing local skill\n---\n')

    const listed = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, { headers: { origin } })
    expect(await listed.json()).toEqual({ skills: [{
      name: 'camera-check',
      description: 'Inspect a camera image',
      path: join(dshHome, 'skills', 'camera-check', 'SKILL.md'),
    }] })

    const refused = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'DELETE', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'unmanaged' }),
    })
    expect(refused.status).toBe(404)
    expect(await refused.json()).toEqual({ error: 'skill is not managed by local import' })

    const removed = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PATH}`, {
      method: 'DELETE', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'camera-check' }),
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ deleted: true })
    await expect(readFile(join(dshHome, 'skills', 'camera-check', 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(unmanaged, 'SKILL.md'), 'utf8')).toContain('Existing local skill')
  })
})

describe('OpenFox local skill native picker route', () => {
  it('returns a selected folder or cancellation and enforces method and origin', async () => {
    const pick = vi.fn(async () => '/local/skill')
    let origin = ''
    const server = createServer((req, res) => {
      void handleRoboLocalSkillPickerRequest(req, res, origin, pick)
    })
    origin = await listen(server)

    const selected = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH}`, {
      method: 'POST', headers: { origin },
    })
    expect(selected.status).toBe(200)
    expect(await selected.json()).toEqual({ path: '/local/skill' })

    const forbidden = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH}`, {
      method: 'POST', headers: { origin: 'https://attacker.example' },
    })
    expect(forbidden.status).toBe(403)
    const wrongMethod = await fetch(`${origin}${ROBO_LOCAL_SKILLS_PICK_DIRECTORY_PATH}`, { headers: { origin } })
    expect(wrongMethod.status).toBe(405)
    expect(pick).toHaveBeenCalledOnce()
  })
})

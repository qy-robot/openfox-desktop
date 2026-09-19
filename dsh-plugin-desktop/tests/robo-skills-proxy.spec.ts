import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  handleRoboSkillsProxyRequest,
  ROBO_DEVICES_CATALOG_PATH,
  ROBO_SKILLS_CATALOG_PATH,
  ROBO_SKILLS_DEMO_RUNS_PATH,
  roboSkillsProxyLimits,
  type RoboSkillsProxyOptions,
} from '../src/robo-skills-proxy.ts'

const catalog = {
  privateRootField: '/private/catalog/root',
  schemaVersion: 1,
  mode: 'local-demo',
  marketRevision: 4,
  featuredSkillIds: ['navigation-diagnostics'],
  categories: [{ id: 'inspection', name: '巡检', visible: true, internalLabel: 'secret-category' }],
  robots: [{
    id: 'qy-x1',
    displayName: '擎云 X1',
    manufacturer: '擎云机器人',
    family: '轮式机器人',
    profiles: [{ id: 'standard', label: '标准版', details: { lidar: true } }],
    privateNotes: 'secret-robot',
  }],
  skills: [{
    id: 'navigation-diagnostics',
    displayName: '导航诊断',
    description: '分析导航日志',
    summary: '分析导航日志',
    version: '0.1.0',
    category: 'inspection',
    robotIndependent: false,
    targets: [{ modelId: 'qy-x1', profileIds: ['standard'] }],
    demo: true,
    instructions: 'private skill instructions',
    details: {
      overview: '检查用户提供的导航状态文本。',
      inputs: ['导航状态文本'],
      outputs: ['规则检查提示'],
      steps: ['检查定位和规划信号'],
      limitations: ['不连接机器人'],
      prompt: 'private nested prompt',
      privateWorkflow: { instructions: 'private nested instructions' },
    },
  }],
} as const

const publicCatalog = {
  schemaVersion: 1,
  mode: 'local-demo',
  marketRevision: 4,
  featuredSkillIds: ['navigation-diagnostics'],
  categories: [{ id: 'inspection', name: '巡检', visible: true }],
  robots: [{
    id: 'qy-x1',
    displayName: '擎云 X1',
    manufacturer: '擎云机器人',
    family: '轮式机器人',
    profiles: [{ id: 'standard', label: '标准版' }],
  }],
  skills: [{
    id: 'navigation-diagnostics',
    displayName: '导航诊断',
    description: '分析导航日志',
    summary: '分析导航日志',
    version: '0.1.0',
    category: 'inspection',
    robotIndependent: false,
    targets: [{ modelId: 'qy-x1', profileIds: ['standard'] }],
    demo: true,
    details: {
      overview: '检查用户提供的导航状态文本。',
      inputs: ['导航状态文本'],
      outputs: ['规则检查提示'],
      limitations: ['不连接机器人'],
    },
  }],
} as const

const demoRequest = {
  skillId: 'navigation-diagnostics',
  skillVersion: '0.1.0',
  modelId: 'qy-x1',
  profileId: 'standard',
  text: '检查今天的导航日志',
} as const

const demoResponse = {
  mode: 'local-demo',
  skillId: 'navigation-diagnostics',
  skillVersion: '0.1.0',
  summary: '演示分析完成',
  findings: [{ level: 'info', message: '未发现阻塞问题' }],
  demo: true,
  trace: '/private/demo/trace',
} as const

const publicDemoResponse = {
  mode: 'local-demo',
  skillId: 'navigation-diagnostics',
  skillVersion: '0.1.0',
  summary: '演示分析完成',
  findings: [{ level: 'info', message: '未发现阻塞问题' }],
  demo: true,
} as const

const servers = new Set<Server>()

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

async function stop(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  servers.delete(server)
}

afterEach(async () => {
  await Promise.all([...servers].map(stop))
})

async function startUpstream(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<{ origin: string, server: Server }> {
  const server = createServer((req, res) => { void handler(req, res) })
  return { origin: await listen(server), server }
}

async function startProxy(
  routePath: typeof ROBO_SKILLS_CATALOG_PATH | typeof ROBO_DEVICES_CATALOG_PATH | typeof ROBO_SKILLS_DEMO_RUNS_PATH,
  options: RoboSkillsProxyOptions = {},
): Promise<{ origin: string, server: Server }> {
  let origin = ''
  const server = createServer((req, res) => {
    void handleRoboSkillsProxyRequest(req, res, origin, routePath, options)
  })
  origin = await listen(server)
  return { origin, server }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('OpenFox local skills proxy', () => {
  it('returns an explicit 503 while the local service is not configured', async () => {
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH)
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(503)
    expect(await responseJson(response)).toEqual({ error: 'local skills service is not configured' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('forwards only the fixed catalog path without browser credentials', async () => {
    let observed: IncomingMessage | undefined
    const upstream = await startUpstream((req, res) => {
      observed = req
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(catalog))
    })
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: {
        origin: proxy.origin,
        authorization: 'Bearer renderer-secret',
        cookie: 'dsh=renderer-cookie',
      },
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(publicCatalog)
    expect(JSON.stringify(body)).not.toContain('private nested instructions')
    expect(JSON.stringify(body)).not.toContain('privateWorkflow')
    expect(JSON.stringify(body)).not.toContain('private nested prompt')
    expect(JSON.stringify(body)).not.toContain('检查定位和规划信号')
    expect(JSON.stringify(body)).not.toContain('steps')
    expect(observed?.method).toBe('GET')
    expect(observed?.url).toBe('/v1/catalog')
    expect(observed?.headers.authorization).toBeUndefined()
    expect(observed?.headers.cookie).toBeUndefined()
  })

  it('preserves compatibility with catalogs that omit optional skill details', async () => {
    const legacyCatalog = {
      ...catalog,
      skills: catalog.skills.map(({ details: _details, ...skill }) => skill),
    }
    const legacyPublicCatalog = {
      ...publicCatalog,
      skills: publicCatalog.skills.map(({ details: _details, ...skill }) => skill),
    }
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(legacyCatalog))
    })
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(legacyPublicCatalog)
  })

  it('projects published catalog metadata without turning entries into runnable demos', async () => {
    const publishedCatalog = {
      ...catalog,
      mode: 'catalog',
      skills: catalog.skills.map(skill => ({ ...skill, demo: false })),
    }
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(publishedCatalog))
    })
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, { headers: { origin: proxy.origin } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ...publicCatalog,
      mode: 'catalog',
      skills: publicCatalog.skills.map(skill => ({ ...skill, demo: false })),
    })
  })

  it.each([
    { overview: '', inputs: [], outputs: [], limitations: [] },
    { overview: '有效简介', inputs: '不是数组', outputs: [], limitations: [] },
    { overview: '有效简介', inputs: [], outputs: [], limitations: ['x'.repeat(2_049)] },
    { overview: '有效简介', inputs: [], outputs: [] },
  ])('rejects malformed optional skill details: %j', async (details) => {
    const malformedCatalog = {
      ...catalog,
      skills: [{ ...catalog.skills[0], details }],
    }
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(malformedCatalog))
    })
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(502)
    expect(await responseJson(response)).toEqual({
      error: 'local skills service returned an invalid response',
    })
  })

  it('validates and forwards a bounded demonstration request', async () => {
    let upstreamBody = ''
    const upstream = await startUpstream(async (req, res) => {
      for await (const chunk of req) upstreamBody += chunk.toString()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(demoResponse))
    })
    const proxy = await startProxy(ROBO_SKILLS_DEMO_RUNS_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}`, {
      method: 'POST',
      headers: { origin: proxy.origin, 'content-type': 'application/json' },
      body: JSON.stringify(demoRequest),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(publicDemoResponse)
    expect(JSON.parse(upstreamBody)).toEqual(demoRequest)
  })

  it.each([
    'https://127.0.0.1:8000',
    'http://example.com:8000',
    'http://user:pass@127.0.0.1:8000',
    'http://127.0.0.1:8000/private',
    'http://127.0.0.1:8000?token=secret',
    'http://127.0.0.1:8000#fragment',
    'http://127.0.0.1',
  ])('rejects unsafe local service configuration without making a request: %s', async (serviceUrl) => {
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(503)
    expect(await responseJson(response)).toEqual({ error: 'local skills service configuration is invalid' })
  })

  it('rejects a bad renderer origin before contacting the local service', async () => {
    let calls = 0
    const upstream = await startUpstream((_req, res) => {
      calls += 1
      res.end(JSON.stringify(catalog))
    })
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: 'https://example.com' },
    })

    expect(response.status).toBe(403)
    expect(calls).toBe(0)
  })

  it('rejects query-bearing renderer paths and oversized request bodies', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.end(JSON.stringify(demoResponse))
    })
    const proxy = await startProxy(ROBO_SKILLS_DEMO_RUNS_PATH, { serviceUrl: upstream.origin })
    const queryResponse = await fetch(`${proxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}?next=/private`, {
      method: 'POST',
      headers: { origin: proxy.origin, 'content-type': 'application/json' },
      body: JSON.stringify(demoRequest),
    })
    const oversizedResponse = await fetch(`${proxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}`, {
      method: 'POST',
      headers: { origin: proxy.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ...demoRequest, text: 'x'.repeat(roboSkillsProxyLimits.maxRequestBodyBytes) }),
    })

    expect(queryResponse.status).toBe(404)
    expect(oversizedResponse.status).toBe(413)
  })

  it('times out a stalled local service with a safe error', async () => {
    const upstream = await startUpstream(() => {})
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, {
      serviceUrl: upstream.origin,
      timeoutMs: 30,
    })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(504)
    expect(await responseJson(response)).toEqual({ error: 'local skills service timed out' })
  })

  it('bounds upstream responses and does not echo upstream failures', async () => {
    const oversized = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ padding: 'x'.repeat(roboSkillsProxyLimits.maxDemoResponseBytes) }))
    })
    const oversizedProxy = await startProxy(ROBO_SKILLS_DEMO_RUNS_PATH, {
      serviceUrl: oversized.origin,
    })
    const oversizedResponse = await fetch(`${oversizedProxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}`, {
      method: 'POST',
      headers: { origin: oversizedProxy.origin, 'content-type': 'application/json' },
      body: JSON.stringify(demoRequest),
    })

    expect(oversizedResponse.status).toBe(502)
    expect(await responseJson(oversizedResponse)).toEqual({
      error: 'local skills service response is too large',
    })

    const failed = await startUpstream((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: '/private/service/path: database password rejected' }))
    })
    const failedProxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { serviceUrl: failed.origin })
    const failedResponse = await fetch(`${failedProxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: failedProxy.origin },
    })
    const body = await responseJson(failedResponse)

    expect(failedResponse.status).toBe(502)
    expect(body).toEqual({ error: 'local skills service is unavailable' })
    expect(JSON.stringify(body)).not.toContain('/private')
    expect(JSON.stringify(body)).not.toContain('password')
  })

  it.each([400, 404, 409, 413])(
    'passes through upstream demonstration status %i with a safe error body',
    async (status) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          error: {
            code: 'private_service_code',
            message: '/private/service/path: database password rejected',
          },
        }))
      })
      const proxy = await startProxy(ROBO_SKILLS_DEMO_RUNS_PATH, { serviceUrl: upstream.origin })
      const response = await fetch(`${proxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}`, {
        method: 'POST',
        headers: { origin: proxy.origin, 'content-type': 'application/json' },
        body: JSON.stringify(demoRequest),
      })
      const body = await responseJson(response)

      expect(response.status).toBe(status)
      expect(body).toEqual({ error: 'local skills service rejected the request' })
      expect(JSON.stringify(body)).not.toContain('/private')
      expect(JSON.stringify(body)).not.toContain('password')
      expect(JSON.stringify(body)).not.toContain('private_service_code')
    },
  )

  it('treats unexpected upstream status codes as a bad gateway', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(415, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'private protocol detail' } }))
    })
    const proxy = await startProxy(ROBO_SKILLS_DEMO_RUNS_PATH, { serviceUrl: upstream.origin })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_DEMO_RUNS_PATH}`, {
      method: 'POST',
      headers: { origin: proxy.origin, 'content-type': 'application/json' },
      body: JSON.stringify(demoRequest),
    })

    expect(response.status).toBe(502)
    expect(await responseJson(response)).toEqual({ error: 'local skills service is unavailable' })
  })
  it('reads only the configured first-party public catalog and projects safe tutorial and publisher metadata', async () => {
    let requested = ''; let credentials: RequestCredentials | undefined
    const upstreamCatalog = { ...catalog,
      robots: catalog.robots.map(robot => ({ ...robot, description: 'Robot', configuration: { network: 'Wi-Fi' }, tutorialUrl: 'https://docs.feishu.cn/wiki/setup' })),
      skills: catalog.skills.map(skill => ({ ...skill, publisher: { kind: 'company', displayName: '小高', labels: ['擎云·小高'], subject: 'private-account' } })),
    }
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, { catalogUrl: 'https://api.openfox.work/api/catalog', fetch: async (url, init) => {
      requested = String(url); credentials = init?.credentials
      return new Response(JSON.stringify(upstreamCatalog), { headers: { 'content-type': 'application/json' } })
    } })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, { headers: { origin: proxy.origin } })
    expect(response.status).toBe(200)
    const body = await response.json() as typeof upstreamCatalog
    expect(requested).toBe('https://api.openfox.work/api/catalog')
    expect(credentials).toBe('omit')
    expect(body.robots[0]?.tutorialUrl).toBe('https://docs.feishu.cn/wiki/setup')
    expect(body.skills[0]?.publisher).toEqual({ kind: 'company', displayName: '小高', labels: ['擎云·小高'] })
    expect(JSON.stringify(body)).not.toContain('private-account')
    expect(JSON.stringify(body)).not.toContain('secret-robot')
  })

  it('loads the independent first-party device catalog without depending on skills', async () => {
    let requested = ''
    const devices = { schemaVersion: 1, mode: 'catalog', robots: catalog.robots }
    const proxy = await startProxy(ROBO_DEVICES_CATALOG_PATH, { catalogUrl: 'https://api.openfox.work/api/catalog', fetch: async (url) => {
      requested = String(url)
      return new Response(JSON.stringify(devices), { headers: { 'content-type': 'application/json' } })
    } })
    const response = await fetch(`${proxy.origin}${ROBO_DEVICES_CATALOG_PATH}`, { headers: { origin: proxy.origin } })
    expect(response.status).toBe(200)
    expect(requested).toBe('https://api.openfox.work/api/catalog/devices')
    expect(await response.json()).toEqual({ schemaVersion: 1, mode: 'catalog', robots: publicCatalog.robots, categories: [], skills: [], featuredSkillIds: [] })
  })

  it('reports an unpublished first-party catalog without disguising it as a bad gateway', async () => {
    const proxy = await startProxy(ROBO_SKILLS_CATALOG_PATH, {
      catalogUrl: 'https://api.openfox.work/api/catalog',
      fetch: async () => new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    })
    const response = await fetch(`${proxy.origin}${ROBO_SKILLS_CATALOG_PATH}`, {
      headers: { origin: proxy.origin },
    })

    expect(response.status).toBe(503)
    expect(await responseJson(response)).toEqual({
      error: 'public skills catalog is not published',
    })
  })

})

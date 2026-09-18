import { createHash, randomBytes } from 'node:crypto'
import type { RoboCodingFundingMode, RoboCodingTeamView } from './robocoding-account-contract.ts'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

export interface RoboCodingTokenBundle {
  readonly accessToken: string
  readonly refreshToken: string
  readonly accessExpiresAt: string
  readonly sessionId: string
  readonly user: { readonly id: number; readonly username: string; readonly displayName: string }
}

export interface RoboCodingDeviceGrant {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly verificationUriComplete: string
  readonly expiresIn: number
  readonly interval: number
  readonly verifier: string
}

export interface RoboCodingDashboard {
  readonly user: RoboCodingTokenBundle['user'] & { readonly balancePoints: number }
  readonly teams: readonly RoboCodingTeamView[]
  readonly models: readonly string[]
  readonly pointsPerCny: number
}

export interface RoboCodingRelayCredential {
  readonly key: string
  readonly baseUrl: string
  readonly expiresAt: string
  readonly fundingMode: RoboCodingFundingMode
  readonly teamId: number
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost'
}

export function parseRoboCodingPlatformUrl(value: string): URL {
  const url = parseRoboCodingExternalUrl(value)
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError('平台地址不能包含凭据、查询参数或片段')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url
}

export function parseRoboCodingExternalUrl(value: string): URL {
  const url = new URL(value)
  if (url.username !== '' || url.password !== '') throw new TypeError('平台地址不能包含凭据')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new TypeError('平台地址必须使用 HTTPS；仅本机调试可使用 HTTP')
  }
  return url
}

function endpoint(base: URL, path: string): URL {
  const url = new URL(path, `${base.origin}/`)
  if (url.origin !== base.origin) throw new TypeError('平台接口必须与平台地址同源')
  return url
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('平台返回了无效数据')
  return value as Record<string, unknown>
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`平台返回缺少 ${name}`)
  return value
}

function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`平台返回了无效的 ${name}`)
  return value
}

function integer(value: unknown, name: string): number {
  const result = number(value, name)
  if (!Number.isSafeInteger(result)) throw new TypeError(`平台返回了无效的 ${name}`)
  return result
}

function timestamp(value: unknown, name: string): string {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString()
  }
  throw new TypeError(`平台返回了无效的 ${name}`)
}

function responseData(value: unknown): unknown {
  const outer = record(value)
  if (outer.success === false) throw new Error(typeof outer.message === 'string' ? outer.message : '平台请求失败')
  return Object.prototype.hasOwnProperty.call(outer, 'data') ? outer.data : outer
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('平台响应过大')
  }
  if (response.body === null) throw new Error('平台响应为空')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('平台响应过大')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export class RoboCodingPlatformClient {
  constructor(readonly baseUrl: URL, private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = parseRoboCodingPlatformUrl(baseUrl.href)
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(endpoint(this.baseUrl, path), {
      ...init,
      signal: init.signal === undefined || init.signal === null
        ? AbortSignal.timeout(30_000) : AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json', ...init.headers },
    })
    const value = await readBoundedJson(response)
    if (!response.ok) {
      const body = record(value)
      const code = typeof body.error === 'string' ? body.error : `http_${String(response.status)}`
      const error = new Error(typeof body.message === 'string' ? body.message : code)
      error.name = code
      throw error
    }
    return responseData(value)
  }

  async createDeviceGrant(deviceName: string): Promise<RoboCodingDeviceGrant> {
    const verifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    const data = record(await this.request('/api/desktop/device/code', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_name: deviceName, code_challenge: codeChallenge }),
    }))
    const verificationUri = string(data.verification_uri, 'verification_uri')
    const verificationUriComplete = string(data.verification_uri_complete, 'verification_uri_complete')
    for (const target of [verificationUri, verificationUriComplete]) {
      const parsed = parseRoboCodingExternalUrl(target)
      if (parsed.origin !== this.baseUrl.origin) throw new TypeError('登录页面必须与平台地址同源')
    }
    return {
      deviceCode: string(data.device_code, 'device_code'), userCode: string(data.user_code, 'user_code'),
      verificationUri, verificationUriComplete, expiresIn: integer(data.expires_in, 'expires_in'),
      interval: integer(data.interval, 'interval'), verifier,
    }
  }

  async pollDeviceToken(grant: RoboCodingDeviceGrant): Promise<RoboCodingTokenBundle> {
    const data = await this.request('/api/desktop/device/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: grant.deviceCode, code_verifier: grant.verifier }),
    })
    return parseTokenBundle(data)
  }

  async refresh(refreshToken: string, sessionId: string): Promise<RoboCodingTokenBundle> {
    return parseTokenBundle(await this.request('/api/desktop/refresh', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, session_id: sessionId }),
    }))
  }

  async dashboard(accessToken: string): Promise<RoboCodingDashboard> {
    const bearer = { authorization: `Bearer ${accessToken}` }
    const [selfRaw, teamsRaw, statusRaw, modelsRaw] = await Promise.all([
      this.request('/api/user/self', { headers: bearer }), this.request('/api/teams/self', { headers: bearer }),
      this.request('/api/status'), this.request('/api/user/models', { headers: bearer }),
    ])
    const self = record(selfRaw)
    const status = record(statusRaw)
    const quotaPerPoint = number(status.quota_per_point, 'quota_per_point')
    if (quotaPerPoint <= 0) throw new TypeError('quota_per_point 必须大于零')
    if (status.billing_currency !== 'CNY' || status.points_per_cny !== 10) throw new TypeError('平台点数计价配置不匹配')
    const convert = (quota: unknown): number => number(quota, 'quota') / quotaPerPoint
    const teams = (Array.isArray(teamsRaw) ? teamsRaw : []).map((item): RoboCodingTeamView => {
      const team = record(item)
      const limit = team.monthly_limit_quota
      return {
        id: integer(team.id, 'team.id'), name: string(team.name, 'team.name'), role: string(team.role, 'team.role'),
        department: typeof team.department === 'string' ? team.department : '', balancePoints: convert(team.balance_quota),
        monthlyLimitPoints: limit === null || limit === undefined ? null : convert(limit),
        monthlyUsedPoints: convert(team.monthly_used_quota), month: string(team.month, 'team.month'),
      }
    })
    const models = (Array.isArray(modelsRaw) ? modelsRaw : []).filter((value): value is string => typeof value === 'string' && value !== '')
    return { user: { id: integer(self.id, 'user.id'), username: string(self.username, 'user.username'),
      displayName: typeof self.display_name === 'string' ? self.display_name : string(self.username, 'user.username'),
      balancePoints: convert(self.quota) }, teams, models, pointsPerCny: 10 }
  }

  async models(accessToken: string): Promise<readonly string[]> {
    const data = await this.request('/api/user/models', { headers: { authorization: `Bearer ${accessToken}` } })
    if (!Array.isArray(data) || data.some(value => typeof value !== 'string' || value === '')) {
      throw new TypeError('平台返回了无效的模型目录')
    }
    return [...new Set(data as string[])]
  }

  async relay(accessToken: string, fundingMode: RoboCodingFundingMode, teamId: number, confirmTeam: boolean): Promise<RoboCodingRelayCredential> {
    const data = record(await this.request('/api/desktop/relay-token', {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ funding_mode: fundingMode, team_id: teamId, ...(confirmTeam ? { confirm_team: true } : {}) }),
    }))
    const relayUrl = parseRoboCodingPlatformUrl(string(data.base_url, 'base_url'))
    // The authenticated platform must not redirect relay credentials or prompts to another origin.
    if (relayUrl.origin !== this.baseUrl.origin) throw new TypeError('模型接口必须与平台地址同源')
    if (data.funding_mode !== fundingMode || data.team_id !== teamId) throw new TypeError('平台返回的付款账户不匹配')
    return { key: string(data.key, 'key'), baseUrl: relayUrl.href, expiresAt: timestamp(data.expires_at, 'expires_at'),
      fundingMode: data.funding_mode === 'team_only' ? 'team_only' : 'personal_only', teamId: integer(data.team_id, 'team_id') }
  }

  async logout(accessToken: string): Promise<void> {
    await this.request('/api/desktop/session', { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } })
  }
}

function parseTokenBundle(value: unknown): RoboCodingTokenBundle {
  const data = record(value)
  const user = record(data.user)
  const session = record(data.session)
  return { accessToken: string(data.access_token, 'access_token'), refreshToken: string(data.refresh_token, 'refresh_token'),
    accessExpiresAt: timestamp(data.access_expires_at, 'access_expires_at'), sessionId: string(session.sid, 'session.sid'),
    user: { id: integer(user.id, 'user.id'), username: string(user.username, 'user.username'),
      displayName: typeof user.display_name === 'string' ? user.display_name : string(user.username, 'user.username') } }
}

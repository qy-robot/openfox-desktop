import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { DesktopRuntime } from './runtime.ts'
import type { RoboCodingAccountView, RoboCodingFundingMode } from './robocoding-account-contract.ts'
import {
  parseRoboCodingPlatformUrl,
  RoboCodingPlatformClient,
  type RoboCodingDashboard,
  type RoboCodingDeviceGrant,
  type RoboCodingRelayCredential,
  type RoboCodingTokenBundle,
} from './robocoding-platform.ts'

export interface RoboCodingAccountSettings {
  readonly platformUrl: string
  readonly fundingMode: RoboCodingFundingMode
  readonly teamId: number
  readonly confirmedTeamId: number
  readonly confirmedUserId: number
}

export interface RoboCodingAccountSecret {
  readonly refreshToken: string
  readonly sessionId: string
  readonly platformOrigin: string
}

export interface RoboCodingAccountControllerOptions {
  readonly runtime: Required<Pick<DesktopRuntime, 'readAccountSecret' | 'writeAccountSecret' | 'clearAccountSecret' | 'openExternalUrl'>>
  readonly settings: SettingsScope<RoboCodingAccountSettings>
  readonly onRelay: (relay: RoboCodingRelayCredential, models: readonly string[]) => Promise<void> | void
  readonly onModels?: (models: readonly string[]) => Promise<void> | void
  readonly onLogout?: () => Promise<void> | void
  readonly onRelayUnavailable?: () => Promise<void> | void
  readonly fetcher?: typeof fetch
  readonly defaultPlatformUrl?: string
}

export const DEFAULT_ROBOCODING_PLATFORM_URL = 'https://ai.openfox.work'
// First-party platform hosts stay interchangeable while DNS/ICP filing decides
// which origin is reachable; a configured predecessor host migrates to the
// current default without discarding a stored same-backend session.
const LEGACY_DEFAULT_ROBOCODING_PLATFORM_URLS = ['https://www.openfox.work', 'https://ai.openzrob.com', 'https://www.openzrob.com'] as const

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

// Auth failures that mean the session is gone server-side; everything else
// (429/5xx/timeouts/network) is transient and worth retrying.
function isHardAuthError(cause: unknown): boolean {
  return cause instanceof Error
    && (cause.name === 'AUTH_SESSION_REVOKED' || cause.name === 'AUTH_UNAUTHORIZED' || cause.name === 'http_401')
}

export class RoboCodingAccountController {
  private state: RoboCodingAccountView['state'] = 'signed_out'
  private message: string | undefined
  private dashboard: RoboCodingDashboard | undefined
  private token: RoboCodingTokenBundle | undefined
  private grant: (RoboCodingDeviceGrant & { expiresAt: string }) | undefined
  private poll: AbortController | undefined
  private refreshTask: { readonly generation: number; readonly task: Promise<RoboCodingTokenBundle> } | undefined
  private secretMutation: Promise<void> = Promise.resolve()
  private relayMutation: Promise<void> = Promise.resolve()
  private modelSyncTimer: ReturnType<typeof setTimeout> | undefined
  private renewTimer: ReturnType<typeof setTimeout> | undefined
  private readonly activeTurns = new Set<string>()
  private generation = 0
  private stopped = false

  constructor(private readonly options: RoboCodingAccountControllerOptions) {
    if (options.settings.get().platformUrl === '') this.state = 'unconfigured'
  }

  async restore(): Promise<void> {
    const configuredPlatformUrl = this.options.settings.get().platformUrl
    if ((LEGACY_DEFAULT_ROBOCODING_PLATFORM_URLS as readonly string[]).includes(configuredPlatformUrl)) {
      const secret = await this.options.runtime.readAccountSecret()
      if (secret !== undefined && secret.platformOrigin === configuredPlatformUrl) {
        // Both origins serve the same backend: keep the session, only rebind the origin.
        await this.mutateSecret(() => this.options.runtime.writeAccountSecret({
          refreshToken: secret.refreshToken, sessionId: secret.sessionId,
          platformOrigin: new URL(DEFAULT_ROBOCODING_PLATFORM_URL).origin,
        }))
      }
      await this.options.settings.update({ platformUrl: DEFAULT_ROBOCODING_PLATFORM_URL, fundingMode: 'personal_only', teamId: 0,
        confirmedTeamId: 0, confirmedUserId: 0 })
    }
    if (this.options.settings.get().platformUrl === '') {
      const platformUrl = parseRoboCodingPlatformUrl(
        this.options.defaultPlatformUrl ?? DEFAULT_ROBOCODING_PLATFORM_URL,
      ).href.replace(/\/$/u, '')
      await this.options.settings.update({ platformUrl })
      this.state = 'signed_out'
    }
    const client = this.clientOrUndefined()
    if (client === undefined) return
    const generation = this.generation
    const secret = await this.options.runtime.readAccountSecret()
    this.assertCurrent(generation)
    if (secret === undefined) return
    if (secret.platformOrigin !== client.baseUrl.origin) {
      await this.mutateSecret(() => this.options.runtime.clearAccountSecret())
      return
    }
    try {
      await this.refresh(secret, generation, client)
      await this.mutateRelay(() => this.refreshDashboardAndRelay(false, generation, client))
    } catch (cause) {
      if (this.isCurrent(generation)) this.fail(cause)
    }
  }

  read(): RoboCodingAccountView {
    const settings = this.options.settings.get()
    return {
      state: this.state, platformUrl: settings.platformUrl, teams: this.dashboard?.teams ?? [],
      funding: { mode: settings.fundingMode, teamId: settings.teamId,
        confirmedTeamId: this.dashboard?.user.id === settings.confirmedUserId ? settings.confirmedTeamId : 0 },
      pointsPerCny: this.dashboard?.pointsPerCny ?? 10, billingCurrency: 'CNY',
      ...(this.message === undefined ? {} : { message: this.message }),
      ...(this.dashboard === undefined ? {} : { user: this.dashboard.user }),
      ...(this.grant === undefined ? {} : { verification: { userCode: this.grant.userCode,
        verificationUri: this.grant.verificationUri, expiresAt: this.grant.expiresAt } }),
    }
  }

  turnStarted(sessionId: string, turn: number): void { this.activeTurns.add(`${sessionId}:${String(turn)}`) }
  turnEnded(sessionId: string, turn: number): void { this.activeTurns.delete(`${sessionId}:${String(turn)}`) }
  sessionDisposed(sessionId: string): void {
    for (const key of this.activeTurns) if (key.startsWith(`${sessionId}:`)) this.activeTurns.delete(key)
  }
  sessionsDetached(): void { this.activeTurns.clear() }

  async setPlatformUrl(value: string): Promise<void> {
    this.assertAccountMutable()
    const normalized = value.trim() === '' ? '' : parseRoboCodingPlatformUrl(value.trim()).href.replace(/\/$/u, '')
    if (normalized === this.options.settings.get().platformUrl) return
    await this.logout()
    await this.options.settings.update({ platformUrl: normalized, fundingMode: 'personal_only', teamId: 0,
      confirmedTeamId: 0, confirmedUserId: 0 })
    this.state = normalized === '' ? 'unconfigured' : 'signed_out'
    this.message = undefined
  }

  async beginLogin(): Promise<void> {
    this.assertAccountMutable()
    const generation = this.invalidateAuthorization()
    const client = this.client()
    const grant = await client.createDeviceGrant('OpenFox Desktop')
    this.assertCurrent(generation)
    const expiresAt = new Date(Date.now() + grant.expiresIn * 1000).toISOString()
    this.grant = { ...grant, expiresAt }
    this.state = 'authorizing'
    this.message = undefined
    await this.options.runtime.openExternalUrl(grant.verificationUriComplete)
    this.assertCurrent(generation)
    const poll = new AbortController()
    this.poll = poll
    void this.pollLogin(client, this.grant, poll.signal, generation)
  }

  async selectFunding(mode: RoboCodingFundingMode, teamId: number, confirmTeam: boolean): Promise<void> {
    return this.mutateRelay(() => this.selectFundingNow(mode, teamId, confirmTeam))
  }

  private async selectFundingNow(mode: RoboCodingFundingMode, teamId: number, confirmTeam: boolean): Promise<void> {
    this.assertAccountMutable()
    const generation = this.generation
    const client = this.client()
    await this.ensureFreshAccessToken(generation, client)
    if (this.token === undefined || this.dashboard === undefined) throw new Error('请先登录')
    if (mode === 'team_only' && !this.dashboard.teams.some(team => team.id === teamId)) throw new Error('团队不可用')
    const settings = this.options.settings.get()
    const alreadyConfirmed = settings.confirmedUserId === this.token.user.id && settings.confirmedTeamId === teamId
    if (mode === 'team_only' && !alreadyConfirmed && !confirmTeam) throw new Error('首次使用团队点数需要确认')
    const relay = await client.relay(this.token.accessToken, mode, mode === 'team_only' ? teamId : 0,
      mode === 'team_only' && (alreadyConfirmed || confirmTeam))
    this.assertCurrent(generation)
    this.assertAccountMutable()
    await this.options.onRelay(relay, this.dashboard.models)
    this.assertCurrent(generation)
    this.scheduleModelSync(generation)
    this.scheduleRenewal(relay.expiresAt, generation)
    await this.options.settings.update({ fundingMode: mode, teamId: relay.teamId,
      ...(mode === 'team_only' ? { confirmedTeamId: relay.teamId, confirmedUserId: this.token.user.id } : {}) })
    this.message = undefined
  }

  async reload(): Promise<void> {
    const generation = this.generation
    const client = this.client()
    if (this.token === undefined) {
      const secret = await this.options.runtime.readAccountSecret()
      this.assertCurrent(generation)
      if (secret === undefined) return
      await this.refresh(secret, generation, client)
    } else {
      await this.ensureFreshAccessToken(generation, client)
    }
    await this.mutateRelay(() => this.refreshDashboardAndRelay(false, generation, client))
  }

  async logout(revoke = true): Promise<void> {
    this.assertAccountMutable()
    const client = this.clientOrUndefined()
    const token = this.token
    this.invalidateAuthorization()
    this.token = undefined
    this.dashboard = undefined
    this.grant = undefined
    await this.options.onLogout?.()
    let revokeFailure: unknown
    if (revoke && token !== undefined && client !== undefined) {
      try {
        let accessToken = token.accessToken
        if (Date.parse(token.accessExpiresAt) <= Date.now()) {
          const secret = await this.options.runtime.readAccountSecret()
          if (secret !== undefined && secret.platformOrigin === client.baseUrl.origin) {
            accessToken = (await client.refresh(secret.refreshToken, secret.sessionId)).accessToken
          }
        }
        await client.logout(accessToken)
      } catch (cause) { revokeFailure = cause }
    }
    await this.mutateSecret(() => this.options.runtime.clearAccountSecret())
    await this.options.settings.update({ fundingMode: 'personal_only', teamId: 0, confirmedTeamId: 0, confirmedUserId: 0 })
    this.state = this.options.settings.get().platformUrl === '' ? 'unconfigured' : 'signed_out'
    this.message = revokeFailure === undefined ? undefined : '已退出本机，但无法撤销服务器会话。请在联网后通过网页账户安全页面移除该桌面会话。'
  }

  dispose(): void {
    this.stopped = true
    this.invalidateAuthorization()
    this.activeTurns.clear()
  }

  private client(): RoboCodingPlatformClient {
    const client = this.clientOrUndefined()
    if (client === undefined) throw new Error('请先设置平台地址')
    return client
  }

  private clientOrUndefined(): RoboCodingPlatformClient | undefined {
    const value = this.options.settings.get().platformUrl
    return value === '' ? undefined : new RoboCodingPlatformClient(parseRoboCodingPlatformUrl(value), this.options.fetcher)
  }

  private async pollLogin(client: RoboCodingPlatformClient, grant: RoboCodingDeviceGrant, signal: AbortSignal, generation: number): Promise<void> {
    let interval = Math.max(1, grant.interval) * 1000
    const deadline = Date.now() + grant.expiresIn * 1000
    let firstAttempt = true
    try {
      while (!signal.aborted && Date.now() < deadline) {
        // The user may finish the browser step while the desktop is between polls.
        // Check once immediately so returning to the app does not add a full
        // server-advertised polling interval to the hand-off latency.
        if (!firstAttempt) await wait(interval, signal)
        firstAttempt = false
        try {
          const token = await client.pollDeviceToken(grant)
          this.assertCurrent(generation)
          await this.acceptToken(token, generation, client.baseUrl.origin)
          await this.mutateRelay(() => this.refreshDashboardAndRelay(false, generation, client))
          this.assertCurrent(generation)
          this.grant = undefined
          return
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'authorization_pending') continue
          if (cause instanceof Error && cause.name === 'slow_down') { interval += 5_000; continue }
          throw cause
        }
      }
      throw new Error('登录授权已过期，请重试')
    } catch (cause) {
      if (!signal.aborted && this.isCurrent(generation)) this.fail(cause)
    }
  }

  private async acceptToken(token: RoboCodingTokenBundle, generation: number, platformOrigin: string): Promise<void> {
    this.assertCurrent(generation)
    this.token = token
    await this.mutateSecret(async () => {
      this.assertCurrent(generation)
      await this.options.runtime.writeAccountSecret({ refreshToken: token.refreshToken, sessionId: token.sessionId, platformOrigin })
    })
    this.assertCurrent(generation)
  }

  private async refresh(secret: RoboCodingAccountSecret, generation: number, client: RoboCodingPlatformClient): Promise<RoboCodingTokenBundle> {
    if (secret.platformOrigin !== client.baseUrl.origin) throw new Error('保存的登录状态属于另一个平台，请重新登录')
    if (this.refreshTask?.generation === generation) return this.refreshTask.task
    const task = client.refresh(secret.refreshToken, secret.sessionId)
      .then(async token => { await this.acceptToken(token, generation, client.baseUrl.origin); return token })
      .finally(() => { if (this.refreshTask?.task === task) this.refreshTask = undefined })
    this.refreshTask = { generation, task }
    return task
  }

  private async ensureFreshAccessToken(generation: number, client: RoboCodingPlatformClient): Promise<void> {
    if (this.token === undefined || Date.parse(this.token.accessExpiresAt) - Date.now() >= 60_000) return
    const secret = await this.options.runtime.readAccountSecret()
    this.assertCurrent(generation)
    if (secret === undefined) throw new Error('登录状态已失效，请重新登录')
    await this.refresh(secret, generation, client)
  }

  private async refreshDashboardAndRelay(confirmTeam: boolean, generation: number, client: RoboCodingPlatformClient): Promise<void> {
    this.assertCurrent(generation)
    if (this.token === undefined) throw new Error('登录状态不可用')
    const dashboard = await client.dashboard(this.token.accessToken)
    this.assertCurrent(generation)
    this.dashboard = dashboard
    let settings = this.options.settings.get()
    if ((settings.confirmedUserId !== 0 && settings.confirmedUserId !== dashboard.user.id)
      || (settings.fundingMode === 'team_only' && settings.confirmedUserId !== dashboard.user.id)) {
      await this.options.settings.update({ fundingMode: 'personal_only', teamId: 0, confirmedTeamId: 0, confirmedUserId: 0 })
      this.assertCurrent(generation)
      settings = this.options.settings.get()
    }
    const mode = settings.fundingMode
    const teamId = settings.teamId
    if (mode === 'team_only' && !dashboard.teams.some(team => team.id === teamId)) {
      await this.options.onRelayUnavailable?.()
      this.assertCurrent(generation)
      this.state = 'signed_in'
      this.message = '已选择的团队当前不可用，请手动选择个人点数或其他团队。'
      return
    }
    const relay = await client.relay(this.token.accessToken, mode, teamId,
      mode === 'team_only' && (confirmTeam
        || (settings.confirmedUserId === dashboard.user.id && settings.confirmedTeamId === teamId)))
    this.assertCurrent(generation)
    await this.options.onRelay(relay, dashboard.models)
    this.assertCurrent(generation)
    this.scheduleModelSync(generation)
    this.scheduleRenewal(relay.expiresAt, generation)
    this.state = 'signed_in'
    this.message = undefined
  }

  private fail(cause: unknown): void {
    if (this.stopped) return
    this.state = 'error'
    this.message = cause instanceof Error ? cause.message : String(cause)
  }

  private scheduleModelSync(generation: number): void {
    if (this.options.onModels === undefined || this.modelSyncTimer !== undefined || !this.isCurrent(generation)) return
    this.modelSyncTimer = setTimeout(() => {
      // Keep this timer marked while fetching so manual refresh cannot start overlapping polls.
      void this.mutateRelay(async () => {
        this.assertCurrent(generation)
        if (this.token === undefined) return
        const client = this.client()
        await this.ensureFreshAccessToken(generation, client)
        this.assertCurrent(generation)
        if (this.token === undefined) return
        const models = await client.models(this.token.accessToken)
        this.assertCurrent(generation)
        await this.options.onModels?.(models)
        this.assertCurrent(generation)
        if (this.dashboard !== undefined) this.dashboard = { ...this.dashboard, models }
      }).catch(() => {
        // A transient catalog failure must not discard a valid account or rotate its relay key.
      }).finally(() => {
        if (!this.isCurrent(generation)) return
        this.modelSyncTimer = undefined
        this.scheduleModelSync(generation)
      })
    }, 10_000)
    this.modelSyncTimer.unref?.()
  }

  private scheduleRenewal(expiresAt: string, generation: number): void {
    if (this.renewTimer !== undefined) clearTimeout(this.renewTimer)
    const delay = Math.max(1_000, Math.min(2_147_000_000, Date.parse(expiresAt) - Date.now() - 5 * 60_000))
    this.renewTimer = setTimeout(() => {
      this.renewTimer = undefined
      void this.renewWithRetry(generation, 0)
    }, delay)
  }

  private async renewWithRetry(generation: number, attempt: number): Promise<void> {
    try {
      await this.renew(generation)
    } catch (cause) {
      if (!this.isCurrent(generation)) return
      if (isHardAuthError(cause)) { this.fail(cause); return }
      // Transient failure: keep the signed-in session and retry with backoff.
      // The relay credential stays valid for its TTL, so the account keeps
      // working while the renewal retries.
      const backoff = Math.min(30_000 * 2 ** attempt, 10 * 60_000)
      this.renewTimer = setTimeout(() => { this.renewTimer = undefined; void this.renewWithRetry(generation, attempt + 1) }, backoff)
    }
  }

  private async renew(generation: number): Promise<void> {
    this.assertCurrent(generation)
    if (this.token === undefined) return
    const client = this.client()
    await this.ensureFreshAccessToken(generation, client)
    await this.mutateRelay(() => this.refreshDashboardAndRelay(false, generation, client))
  }

  private invalidateAuthorization(): number {
    this.generation += 1
    if (this.modelSyncTimer !== undefined) clearTimeout(this.modelSyncTimer)
    this.modelSyncTimer = undefined
    this.poll?.abort()
    this.poll = undefined
    if (this.renewTimer !== undefined) clearTimeout(this.renewTimer)
    this.renewTimer = undefined
    return this.generation
  }

  private isCurrent(generation: number): boolean { return !this.stopped && generation === this.generation }
  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new Error('账户操作已取消')
  }
  private assertAccountMutable(): void {
    if (this.activeTurns.size > 0) throw new Error('任务运行期间不能切换支付来源、退出登录或更改平台地址')
  }
  private mutateSecret(operation: () => Promise<void>): Promise<void> {
    const next = this.secretMutation.then(operation, operation)
    this.secretMutation = next.catch(() => {})
    return next
  }
  private mutateRelay(operation: () => Promise<void>): Promise<void> {
    const next = this.relayMutation.then(operation, operation)
    this.relayMutation = next.catch(() => {})
    return next
  }
}

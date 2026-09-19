import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_ROBOCODING_PLATFORM_URL,
  RoboCodingAccountController,
  type RoboCodingAccountSecret,
  type RoboCodingAccountSettings,
} from '../src/robocoding-account-controller.ts'

const initialSettings: RoboCodingAccountSettings = {
  platformUrl: 'https://api.example.com', fundingMode: 'personal_only', teamId: 0, confirmedTeamId: 0, confirmedUserId: 0,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function token(accessToken = 'access', expiresAt = Date.now() + 15 * 60_000) {
  return { success: true, data: { access_token: accessToken, refresh_token: 'refresh-next', access_expires_at: expiresAt,
    session: { sid: 'session-1' }, user: { id: 7, username: 'lin', display_name: 'Lin' } } }
}

function harness(fetcher: typeof fetch, secret: RoboCodingAccountSecret | undefined | null = {
  refreshToken: 'refresh', sessionId: 'session-1', platformOrigin: 'https://api.example.com',
}, settingsPatch: Partial<RoboCodingAccountSettings> = {}, onModels?: (models: readonly string[]) => void) {
  let settingsValue = { ...initialSettings, ...settingsPatch }
  let savedSecret: RoboCodingAccountSecret | undefined = secret ?? undefined
  const settings = {
    get: () => settingsValue,
    update: vi.fn(async (patch: Partial<RoboCodingAccountSettings>) => { settingsValue = { ...settingsValue, ...patch } }),
  } as unknown as SettingsScope<RoboCodingAccountSettings>
  const runtime = {
    readAccountSecret: vi.fn(async () => savedSecret),
    writeAccountSecret: vi.fn(async (next: RoboCodingAccountSecret) => { savedSecret = next }),
    clearAccountSecret: vi.fn(async () => { savedSecret = undefined }),
    openExternalUrl: vi.fn(async () => {}),
  }
  const onRelay = vi.fn()
  const onRelayUnavailable = vi.fn()
  const controller = new RoboCodingAccountController({ runtime, settings, fetcher, onRelay, onLogout: vi.fn(), onRelayUnavailable, ...(onModels === undefined ? {} : { onModels }) })
  return { controller, runtime, settings, onRelay, onRelayUnavailable, readSecret: () => savedSecret }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('OpenFox account controller', () => {
  it('migrates an empty platform to the production ai origin on first restore', async () => {
    const mounted = harness(vi.fn() as unknown as typeof fetch, null, { platformUrl: '' })
    await mounted.controller.restore()
    expect(mounted.settings.update).toHaveBeenCalledWith({ platformUrl: DEFAULT_ROBOCODING_PLATFORM_URL })
    expect(mounted.controller.read()).toMatchObject({ state: 'signed_out', platformUrl: DEFAULT_ROBOCODING_PLATFORM_URL })
  })

  it('clears a legacy www session when adopting the ai origin', async () => {
    const mounted = harness(vi.fn() as unknown as typeof fetch, undefined, { platformUrl: 'https://www.openfox.work' })
    await mounted.controller.restore()
    expect(mounted.runtime.clearAccountSecret).toHaveBeenCalledOnce()
    expect(mounted.settings.update).toHaveBeenCalledWith({ platformUrl: DEFAULT_ROBOCODING_PLATFORM_URL, fundingMode: 'personal_only', teamId: 0, confirmedTeamId: 0, confirmedUserId: 0 })
    expect(mounted.controller.read()).toMatchObject({ state: 'signed_out', platformUrl: DEFAULT_ROBOCODING_PLATFORM_URL })
  })

  it.each(['http://127.0.0.1:3000', 'https://platform.example.com'])(
    'preserves an explicit platform during restore: %s',
    async (platformUrl) => {
      const mounted = harness(vi.fn() as unknown as typeof fetch, null, { platformUrl })
      await mounted.controller.restore()
      expect(mounted.settings.update).not.toHaveBeenCalled()
      expect(mounted.controller.read().platformUrl).toBe(platformUrl)
    },
  )

  it('does not restore a delayed refresh after logout changes the authorization generation', async () => {
    const refresh = deferred<Response>()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (new URL(input instanceof Request ? input.url : input).pathname === '/api/desktop/refresh') return refresh.promise
      throw new Error('unexpected request')
    }) as typeof fetch
    const mounted = harness(fetcher)
    const restoring = mounted.controller.restore()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await mounted.controller.logout(false)
    refresh.resolve(json(token('late-access')))
    await restoring
    expect(mounted.controller.read().state).toBe('signed_out')
    expect(mounted.runtime.writeAccountSecret).not.toHaveBeenCalled()
    expect(mounted.readSecret()).toBeUndefined()
  })

  it('refreshes an expired access token before revoking the server session on logout', async () => {
    const paths: string[] = []
    let refreshes = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      if (path === '/api/desktop/refresh') {
        refreshes += 1
        return json(token(refreshes === 1 ? 'expired-access' : 'fresh-access',
          refreshes === 1 ? Date.now() - 1_000 : Date.now() + 15 * 60_000))
      }
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') return json({ success: true, data: ['model-a'] })
      if (path === '/api/desktop/relay-token') return json({ success: true, data: { key: 'relay', base_url: 'https://api.example.com',
        expires_at: Date.now() + 60_000, funding_mode: 'personal_only', team_id: 0 } })
      if (path === '/api/desktop/session') {
        const request = input instanceof Request ? input : new Request(input, init)
        expect(request.headers.get('authorization')).toBe('Bearer fresh-access')
        return json({ success: true })
      }
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher)
    await mounted.controller.restore()
    await mounted.controller.logout()
    expect(paths.at(-2)).toBe('/api/desktop/refresh')
    expect(paths.at(-1)).toBe('/api/desktop/session')
    expect(mounted.readSecret()).toBeUndefined()
  })

  it('revokes the old server session before switching platform', async () => {
    const paths: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      if (path === '/api/desktop/refresh') return json(token())
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') return json({ success: true, data: ['model-a'] })
      if (path === '/api/desktop/relay-token') return json({ success: true, data: { key: 'relay', base_url: 'https://api.example.com',
        expires_at: Date.now() + 60_000, funding_mode: 'personal_only', team_id: 0 } })
      if (path === '/api/desktop/session') return json({ success: true })
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher)
    await mounted.controller.restore()
    await mounted.controller.setPlatformUrl('https://next.example.com/')
    expect(paths.at(-1)).toBe('/api/desktop/session')
    expect(mounted.controller.read()).toMatchObject({ state: 'signed_out', platformUrl: 'https://next.example.com' })
    expect(mounted.readSecret()).toBeUndefined()
  })

  it('blocks account and funding changes while any turn is active', async () => {
    const mounted = harness(vi.fn() as unknown as typeof fetch, undefined)
    mounted.controller.turnStarted('session-a', 1)
    await expect(mounted.controller.logout(false)).rejects.toThrow('任务运行期间')
    await expect(mounted.controller.setPlatformUrl('https://next.example.com')).rejects.toThrow('任务运行期间')
    mounted.controller.turnEnded('session-a', 1)
    await expect(mounted.controller.logout(false)).resolves.toBeUndefined()
  })

  it('discards a saved refresh grant belonging to another platform origin', async () => {
    const mounted = harness(vi.fn() as unknown as typeof fetch, {
      refreshToken: 'refresh', sessionId: 'session-1', platformOrigin: 'https://old.example.com',
    })
    await mounted.controller.restore()
    expect(mounted.runtime.clearAccountSecret).toHaveBeenCalledOnce()
    expect(mounted.controller.read().state).toBe('signed_out')
  })

  it('checks an authorization grant immediately before waiting for the polling interval', async () => {
    const paths: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      if (path === '/api/desktop/device/code') return json({ success: true, data: {
        device_code: 'device-1', user_code: 'ABCD-EFGH', verification_uri: 'https://api.example.com/verify',
        verification_uri_complete: 'https://api.example.com/verify?user_code=ABCD-EFGH', expires_in: 300, interval: 10,
      } })
      if (path === '/api/desktop/device/token') return json(token('new-access'))
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') return json({ success: true, data: ['model-a'] })
      if (path === '/api/desktop/relay-token') return json({ success: true, data: { key: 'relay', base_url: 'https://api.example.com',
        expires_at: Date.now() + 60_000, funding_mode: 'personal_only', team_id: 0 } })
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher, null)
    await mounted.controller.beginLogin()
    await vi.waitFor(() => expect(paths).toContain('/api/desktop/device/token'))
    await vi.waitFor(() => expect(mounted.controller.read().state).toBe('signed_in'))
  })

  it('keeps an unavailable selected team explicit instead of silently falling back to personal points', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/api/desktop/refresh') return json(token())
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') return json({ success: true, data: ['model-a'] })
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher, undefined, {
      fundingMode: 'team_only', teamId: 9, confirmedTeamId: 9, confirmedUserId: 7,
    })
    await mounted.controller.restore()
    expect(mounted.controller.read()).toMatchObject({
      state: 'signed_in', funding: { mode: 'team_only', teamId: 9 }, message: expect.stringContaining('团队当前不可用'),
    })
    expect(mounted.onRelayUnavailable).toHaveBeenCalledOnce()
    expect(mounted.onRelay).not.toHaveBeenCalled()
  })

  it('serializes balance reloads with funding changes so an older personal relay cannot win', async () => {
    const delayedPersonal = deferred<Response>()
    let relayCalls = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/api/desktop/refresh') return json(token())
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [{ id: 9, name: 'Robot', role: 'member',
        balance_quota: 1000, monthly_limit_quota: 500, monthly_used_quota: 0, month: '2026-09' }] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') return json({ success: true, data: ['model-a'] })
      if (path === '/api/desktop/relay-token') {
        relayCalls += 1
        if (relayCalls === 2) return delayedPersonal.promise
        const request = input instanceof Request ? input : new Request(input, init)
        const requestBody = JSON.parse(await request.text()) as { funding_mode: string; team_id: number }
        return json({ success: true, data: { key: `relay-${String(relayCalls)}`, base_url: 'https://api.example.com',
          expires_at: Date.now() + 60_000, funding_mode: requestBody.funding_mode, team_id: requestBody.team_id } })
      }
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher)
    await mounted.controller.restore()
    const reloading = mounted.controller.reload()
    await vi.waitFor(() => expect(relayCalls).toBe(2))
    const selecting = mounted.controller.selectFunding('team_only', 9, true)
    await Promise.resolve()
    expect(relayCalls).toBe(2)
    delayedPersonal.resolve(json({ success: true, data: { key: 'old-personal', base_url: 'https://api.example.com',
      expires_at: Date.now() + 60_000, funding_mode: 'personal_only', team_id: 0 } }))
    await Promise.all([reloading, selecting])
    expect(mounted.onRelay.mock.calls.at(-1)?.[0]).toMatchObject({ fundingMode: 'team_only', teamId: 9 })
    expect(mounted.controller.read().funding).toMatchObject({ mode: 'team_only', teamId: 9 })
  })
  it('synchronizes changed catalogs, retries after failures, and stops late results after logout', async () => {
    vi.useFakeTimers()
    let models = ['model-a']
    let fail = false
    let late: ReturnType<typeof deferred<Response>> | undefined
    let relayCalls = 0
    const onModels = vi.fn()
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === '/api/desktop/refresh') return json(token())
      if (path === '/api/user/self') return json({ success: true, data: { id: 7, username: 'lin', quota: 100 } })
      if (path === '/api/teams/self') return json({ success: true, data: [] })
      if (path === '/api/status') return json({ success: true, data: { quota_per_point: 10, points_per_cny: 10, billing_currency: 'CNY' } })
      if (path === '/api/user/models') {
        if (late !== undefined) return late.promise
        if (fail) throw new Error('offline')
        return json({ success: true, data: models })
      }
      if (path === '/api/desktop/relay-token') {
        relayCalls += 1
        return json({ success: true, data: { key: 'relay', base_url: 'https://api.example.com/v1',
          expires_at: Date.now() + 3_600_000, funding_mode: 'personal_only', team_id: 0 } })
      }
      throw new Error(`unexpected request ${path}`)
    }) as typeof fetch
    const mounted = harness(fetcher, undefined, {}, onModels)
    try {
      await mounted.controller.restore()
      models = ['model-a', 'new-model']
      await vi.advanceTimersByTimeAsync(10_000)
      expect(onModels).toHaveBeenLastCalledWith(models)
      expect(relayCalls).toBe(1)
      fail = true
      await vi.advanceTimersByTimeAsync(10_000)
      expect(onModels).toHaveBeenCalledTimes(1)
      expect(mounted.controller.read().state).toBe('signed_in')
      fail = false
      models = []
      await vi.advanceTimersByTimeAsync(10_000)
      expect(onModels).toHaveBeenLastCalledWith([])
      late = deferred<Response>()
      await vi.advanceTimersByTimeAsync(10_000)
      await mounted.controller.logout(false)
      late.resolve(json({ success: true, data: ['stale-model'] }))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(onModels).toHaveBeenCalledTimes(2)
      expect(relayCalls).toBe(1)
    } finally { mounted.controller.dispose(); vi.useRealTimers() }
  })

})

import { describe, expect, it, vi } from 'vitest'
import { parseRoboCodingPlatformUrl, RoboCodingPlatformClient } from '../src/robocoding-platform.ts'

describe('RoboCoding platform boundary', () => {
  it('accepts HTTPS and loopback development URLs but rejects remote plaintext and embedded credentials', () => {
    expect(parseRoboCodingPlatformUrl('https://api.example.com/').href).toBe('https://api.example.com/')
    expect(parseRoboCodingPlatformUrl('http://127.0.0.1:3000').origin).toBe('http://127.0.0.1:3000')
    expect(() => parseRoboCodingPlatformUrl('http://api.example.com')).toThrow('HTTPS')
    expect(() => parseRoboCodingPlatformUrl('https://user:secret@api.example.com')).toThrow('凭据')
  })

  it('converts backend quota to points without rounding and preserves team limits', async () => {
    const payloads = new Map([
      ['/api/user/self', { success: true, data: { id: 7, username: 'lin', display_name: 'Lin', quota: 6849.315 } }],
      ['/api/teams/self', { success: true, data: [{ id: 9, name: 'Robot', role: 'owner', department: '', balance_quota: 13698.63, monthly_limit_quota: 6849.315, monthly_used_quota: 3424.6575, month: '2026-09' }] }],
      ['/api/status', { success: true, data: { quota_per_point: 6849.315, points_per_cny: 10, billing_currency: 'CNY' } }],
      ['/api/user/models', { success: true, data: ['model-a', 'model-b'] }],
    ])
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return new Response(JSON.stringify(payloads.get(path)), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const dashboard = await new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher).dashboard('access-secret')
    expect(dashboard.user.balancePoints).toBe(1)
    expect(dashboard.teams[0]).toMatchObject({ balancePoints: 2, monthlyLimitPoints: 1, monthlyUsedPoints: 0.5 })
    expect(dashboard.models).toEqual(['model-a', 'model-b'])
  })

  it('refuses a cross-origin verification page returned by the device endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {
      device_code: 'device', user_code: 'ABCD', verification_uri: 'https://evil.example/login',
      verification_uri_complete: 'https://evil.example/login?code=ABCD', expires_in: 600, interval: 5,
    } }), { status: 200 })) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher).createDeviceGrant('Desktop'))
      .rejects.toThrow('同源')
  })
  it('rejects a relay destination on another origin before credentials can reach the model adapter', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: {
      key: 'relay-secret', base_url: 'https://other.example/v1', expires_at: 1900000000,
      funding_mode: 'personal_only', team_id: 0,
    } })) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher)
      .relay('access', 'personal_only', 0, false)).rejects.toThrow('同源')
  })

  it('rejects a different payer returned by the platform', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true, data: {
      key: 'relay-secret', base_url: 'https://api.example.com/v1', expires_at: 1900000000,
      funding_mode: 'team_only', team_id: 9,
    } })) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher)
      .relay('access', 'personal_only', 0, false)).rejects.toThrow('付款账户')
  })

  it('cancels oversized chunked responses without buffering the rest', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel,
    })
    const fetcher = vi.fn(async () => new Response(stream)) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher)
      .createDeviceGrant('Desktop')).rejects.toThrow('响应过大')
    expect(cancel).toHaveBeenCalledOnce()
    const init = vi.mocked(fetcher).mock.calls[0]?.[1]
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns empty gateway errors into stable HTTP errors instead of leaking JSON.parse', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 502 })) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher)
      .createDeviceGrant('Desktop')).rejects.toMatchObject({ name: 'http_502', message: '平台请求失败（HTTP 502）' })
  })

  it('reports malformed successful responses without exposing the native parser error', async () => {
    const fetcher = vi.fn(async () => new Response('<html>gateway error</html>', { status: 200 })) as typeof fetch
    await expect(new RoboCodingPlatformClient(new URL('https://api.example.com'), fetcher)
      .createDeviceGrant('Desktop')).rejects.toThrow('平台返回了无效 JSON')
  })

})

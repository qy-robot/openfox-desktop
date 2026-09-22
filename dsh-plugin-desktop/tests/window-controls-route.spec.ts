import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleDesktopWindowControlRequest } from '../src/window-controls-route.ts'
import type { DesktopWindowControlAction } from '../src/window-controls-contract.ts'

function jsonRequest(value: unknown, origin = 'http://127.0.0.1:43120'): IncomingMessage {
  const req = Readable.from([JSON.stringify(value)]) as IncomingMessage
  req.method = 'POST'
  req.headers = { origin, 'content-type': 'application/json' }
  return req
}

function request(origin = 'http://127.0.0.1:43120', method = 'POST'): IncomingMessage {
  return { method, headers: { origin } } as IncomingMessage
}

function response(): ServerResponse & {
  body: string
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

describe('desktop window controls route', () => {
  it.each(['minimize', 'toggle-maximize', 'close'] as const)(
    'forwards the accepted %s caption action to the Host',
    async (action: DesktopWindowControlAction) => {
      const controlWindow = vi.fn()
      const res = response()

      await handleDesktopWindowControlRequest(
        jsonRequest({ action }),
        res,
        'http://127.0.0.1:43120',
        controlWindow,
      )

      expect(controlWindow).toHaveBeenCalledOnce()
      expect(controlWindow).toHaveBeenCalledWith(action)
      expect(res.statusCode).toBe(200)
      expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8')
      expect(JSON.parse(res.body)).toEqual({ accepted: true })
    },
  )

  it('rejects cross-origin callers before touching the window', async () => {
    const controlWindow = vi.fn()
    const res = response()

    await handleDesktopWindowControlRequest(
      request('https://example.attacker'),
      res,
      'http://127.0.0.1:43120',
      controlWindow,
    )

    expect(controlWindow).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('rejects non-POST methods', async () => {
    const controlWindow = vi.fn()
    const res = response()

    await handleDesktopWindowControlRequest(
      request(undefined, 'GET'),
      res,
      'http://127.0.0.1:43120',
      controlWindow,
    )

    expect(controlWindow).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(405)
  })

  it.each([
    ['an unknown action', { action: 'destroy' }],
    ['a missing action', {}],
    ['a non-object body', 'minimize'],
  ])('rejects %s without touching the window', async (_label: string, body: unknown) => {
    const controlWindow = vi.fn()
    const reportError = vi.fn()
    const res = response()

    await handleDesktopWindowControlRequest(
      jsonRequest(body),
      res,
      'http://127.0.0.1:43120',
      controlWindow,
      reportError,
    )

    expect(controlWindow).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(400)
  })
})

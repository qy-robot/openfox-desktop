import type { IncomingMessage, ServerResponse } from 'node:http'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  desktopPowerShellLaunch,
  DesktopPowerShellController,
  type DesktopPowerShellPty,
} from '../src/desktop-powershell-controller.ts'
import { handleDesktopPowerShellRequest, parseDesktopPowerShellRequest } from '../src/desktop-powershell-route.ts'

const ORIGIN = 'http://127.0.0.1:43120'

class FakePty implements DesktopPowerShellPty {
  readonly pid = 42
  readonly write = vi.fn()
  readonly resize = vi.fn()
  readonly kill = vi.fn()
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(private readonly startupOutput = '') {}

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    if (this.startupOutput !== '') listener(this.startupOutput)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) listener({ exitCode })
  }
}

function jsonRequest(value: unknown, origin = ORIGIN): IncomingMessage {
  const body = JSON.stringify(value)
  const req = Readable.from([body]) as IncomingMessage
  req.method = 'POST'
  req.headers = { origin, 'content-type': 'application/json; charset=utf-8' }
  return req
}

function response(): ServerResponse & { body: string } {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & { body: string }
}

describe('embedded PowerShell launch', () => {
  it('launches local PowerShell and robot SSH without a command shell', () => {
    const toolDirectory = join(process.cwd(), 'terminal-tools')
    const environment = { Path: toolDirectory }
    const exists = (path: string) => path === join(toolDirectory, 'pwsh.exe') || path === join(toolDirectory, 'ssh.exe')

    expect(desktopPowerShellLaunch({ kind: 'local' }, environment, exists)).toEqual({
      executable: join(toolDirectory, 'pwsh.exe'),
      args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass'],
    })
    expect(desktopPowerShellLaunch({
      kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
      ssh: { host: 'robot.local', user: 'operator', port: 2222, identityFile: 'C:\\keys\\robot' },
    }, environment, exists)).toEqual({
      executable: join(toolDirectory, 'ssh.exe'),
      args: ['-tt', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
        '-p', '2222', '-i', 'C:\\keys\\robot', 'operator@robot.local'],
    })
    expect(environment.Path?.split(delimiter)).toContain(toolDirectory)
  })

  it('keeps synchronous startup output and owns write, resize, read, and close lifecycle', () => {
    const pty = new FakePty('\u001b[32mready\u001b[0m\r\n')
    const spawnPty = vi.fn(() => pty)
    const controller = new DesktopPowerShellController({
      platform: 'win32',
      environment: { Path: join(process.cwd(), 'terminal-tools') },
      exists: () => true,
      spawnPty,
    })

    const opened = controller.open({ kind: 'local' }, 120, 32)
    expect(opened.output).toBe('ready\n')
    expect(opened.offset).toBe(6)
    pty.emitData('\u001b[31mnext\u001b[0m\r\n')
    expect(controller.read(opened.sessionId, opened.offset)).toEqual({
      output: 'next\n', offset: 11, truncated: false, exited: false,
    })

    controller.write(opened.sessionId, 'Get-Date\r')
    controller.resize(opened.sessionId, 100, 24)
    expect(pty.write).toHaveBeenCalledWith('Get-Date\r')
    expect(pty.resize).toHaveBeenCalledWith(100, 24)

    controller.close(opened.sessionId)
    expect(pty.kill).toHaveBeenCalledOnce()
    expect(() => controller.read(opened.sessionId, 0)).toThrow('terminal session not found')
    controller.dispose()
  })

  it('reports PTY exit state and output', () => {
    const pty = new FakePty()
    const controller = new DesktopPowerShellController({
      platform: 'win32', environment: { Path: join(process.cwd(), 'terminal-tools') },
      exists: () => true, spawnPty: () => pty,
    })
    const opened = controller.open({ kind: 'local' }, 80, 24)
    pty.emitExit(17)

    expect(controller.read(opened.sessionId, 0)).toEqual({
      output: '\n[终端已退出，代码 17]\n',
      offset: 15,
      truncated: false,
      exited: true,
      exitCode: 17,
    })
    controller.dispose()
  })
})
describe('embedded PowerShell route', () => {
  it('validates local, SSH, dimensions, session ids, and terminal input', () => {
    expect(parseDesktopPowerShellRequest({
      action: 'open', target: { kind: 'local' }, cols: 120, rows: 32,
    })).toEqual({ action: 'open', target: { kind: 'local' }, cols: 120, rows: 32 })
    expect(parseDesktopPowerShellRequest({
      action: 'open',
      target: {
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
        ssh: { host: 'robot.local', user: 'operator', port: 2222 },
      },
      cols: 120,
      rows: 32,
    })).toEqual({
      action: 'open',
      target: {
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
        ssh: { host: 'robot.local', user: 'operator', port: 2222 },
      },
      cols: 120,
      rows: 32,
    })
    expect(parseDesktopPowerShellRequest({
      action: 'open', target: { kind: 'robot', modelId: 'r', profileId: 'p', label: 'R', ssh: { host: '-oProxyCommand=bad' } },
      cols: 120, rows: 32,
    })).toBeUndefined()
    expect(parseDesktopPowerShellRequest({ action: 'open', target: { kind: 'local' }, cols: 10, rows: 32 })).toBeUndefined()
    expect(parseDesktopPowerShellRequest({ action: 'write', sessionId: 'not-a-session', data: 'Get-Date\r' })).toBeUndefined()
  })

  it('enforces origin before dispatching a validated operation', async () => {
    const target = { kind: 'local' } as const
    const controller = {
      open: vi.fn(() => ({ sessionId: '11111111-1111-4111-8111-111111111111', target, output: '', offset: 0 })),
      read: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn(),
    }
    const forbidden = response()
    await handleDesktopPowerShellRequest(
      jsonRequest({ action: 'open', target, cols: 120, rows: 32 }, 'https://example.com'),
      forbidden,
      ORIGIN,
      controller as unknown as DesktopPowerShellController,
    )
    expect(forbidden.statusCode).toBe(403)
    expect(controller.open).not.toHaveBeenCalled()

    const accepted = response()
    await handleDesktopPowerShellRequest(
      jsonRequest({ action: 'open', target, cols: 120, rows: 32 }),
      accepted,
      ORIGIN,
      controller as unknown as DesktopPowerShellController,
    )
    expect(accepted.statusCode).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111', target, output: '', offset: 0,
    })
    expect(controller.open).toHaveBeenCalledWith(target, 120, 32)
  })
})

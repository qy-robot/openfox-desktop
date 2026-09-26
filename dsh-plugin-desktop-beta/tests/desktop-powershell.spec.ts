// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  collectPowerShellEntries,
  DesktopPowerShell,
  DesktopPowerShellLauncher,
  isPowerShellToolName,
  parsePowerShellCommand,
  terminalTargetForSelection,
} from '../src/client/desktop-powershell.tsx'
import type { DesktopPowerShellApi } from '../src/client/desktop-powershell-api.ts'
import { createRoboDeviceSelection } from '../src/client/robo-device-selection.ts'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function apiHarness() {
  let count = 0
  const api: DesktopPowerShellApi = {
    open: vi.fn(async target => ({ sessionId: `session-${String(++count)}`, target, output: '', offset: 0 })),
    read: vi.fn(async (_sessionId, offset) => ({ output: '', offset, truncated: false, exited: true, exitCode: 0 })),
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  return api
}

describe('Desktop PowerShell activity projection', () => {
  it('recognizes the foreground and persistent PowerShell tool names', () => {
    expect(isPowerShellToolName('pwsh')).toBe(true)
    expect(isPowerShellToolName('tool-pwsh')).toBe(true)
    expect(isPowerShellToolName('powershell')).toBe(true)
    expect(isPowerShellToolName('bash')).toBe(false)
  })

  it('extracts a command from tool arguments and keeps malformed payloads visible', () => {
    expect(parsePowerShellCommand('{"command":"Get-Process"}')).toBe('Get-Process')
    expect(parsePowerShellCommand('{"code":"Write-Output ok"}')).toBe('Write-Output ok')
    expect(parsePowerShellCommand('raw command')).toBe('raw command')
  })

  it('projects running and settled calls in chronological order', () => {
    const running = {
      callId: 'running', name: 'pwsh', argsRaw: '{"command":"Get-Date"}', turn: 1, step: 1, time: 10, subCalls: [],
    }
    const settled = {
      kind: 'tool-result', callId: 'settled', seq: 2, time: 20, callTime: 19,
      call: { name: 'pwsh', argsRaw: '{"command":"Write-Output ok"}' },
      content: [{ type: 'text', text: 'ok' }], isError: false, subCalls: [],
    }
    const entries = collectPowerShellEntries({
      legacy: {
        nodes: [settled],
        runningCalls: [running],
      },
    } as never)

    expect(entries.map(entry => [entry.callId, entry.state, entry.command, entry.output])).toEqual([
      ['running', 'running', 'Get-Date', ''],
      ['settled', 'complete', 'Write-Output ok', 'ok'],
    ])
  })

  it('routes an empty selection locally and a selected robot through its supplied SSH target', () => {
    expect(terminalTargetForSelection({ modelId: '', profileId: '' }, '')).toEqual({ kind: 'local' })
    expect(terminalTargetForSelection({ modelId: 'robot-1', profileId: 'standard' }, 'Robot 1')).toBeUndefined()
    expect(terminalTargetForSelection({
      modelId: 'robot-1', profileId: 'standard', ssh: { host: '192.0.2.20', user: 'robot', port: 2222 },
    }, 'Robot 1')).toEqual({
      kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
      ssh: { host: '192.0.2.20', user: 'robot', port: 2222 },
    })
  })

  it('closes the local PTY and opens the robot SSH PTY when robot selection changes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const api = apiHarness()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(DesktopPowerShellLauncher, { device, api })) })
      const launcher = container.querySelector('.dshDesktopPowerShellButton')
      if (!(launcher instanceof HTMLButtonElement)) throw new Error('terminal launcher missing')
      act(() => { launcher.click() })
      await settle()
      expect(api.open).toHaveBeenNthCalledWith(1, { kind: 'local' }, 120, 32, expect.any(AbortSignal))

      act(() => { device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' }) })
      await settle()
      expect(api.close).toHaveBeenCalledWith('session-1')
      expect(api.open).toHaveBeenNthCalledWith(2, {
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
        ssh: { host: 'robot.local', user: 'operator' },
      }, 120, 32, expect.any(AbortSignal))
    } finally {
      await act(async () => { root.unmount() })
      device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('automatically opens for a pending PowerShell approval and exposes run and cancel', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const api = apiHarness()
    const answer = vi.fn(async () => {})
    const pending = { kind: 'approval', key: 'approval-1', toolName: 'pwsh', callId: 'call-1', reason: 'Review this command.', answer }
    const running = { callId: 'call-1', name: 'pwsh', argsRaw: '{"command":"Get-Date"}', turn: 1, step: 1, time: 10, subCalls: [] }
    const useChat = (selector: (snapshot: unknown) => unknown) => selector({ legacy: { nodes: [], runningCalls: [running] } })
    const usePending = (selector: (snapshot: Map<string, unknown>) => unknown) => selector(new Map([['session-1', pending]]))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement('div', null,
          createElement(DesktopPowerShellLauncher, { device, api }),
          createElement(DesktopPowerShell, {
            sessionId: 'session-1', useChat, useSessionPendingInteraction: usePending,
          } as never)))
      })
      await settle()
      expect(container.querySelector('.dshDesktopPowerShellDrawer')).not.toBeNull()
      expect(container.querySelector('.dshDesktopPowerShellApproval pre')?.textContent).toContain('Get-Date')
      const buttons = [...container.querySelectorAll('.dshDesktopPowerShellApproval button')]
      expect(buttons).toHaveLength(2)
      act(() => { (buttons[1] as HTMLButtonElement).click() }); await settle()
      expect(answer).toHaveBeenCalledWith('allowed-once')
      act(() => { (buttons[0] as HTMLButtonElement).click() }); await settle()
      expect(answer).toHaveBeenCalledWith('rejected')
    } finally {
      await act(async () => { root.unmount() })
      device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })
})

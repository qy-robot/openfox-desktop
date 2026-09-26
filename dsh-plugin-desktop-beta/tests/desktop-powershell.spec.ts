// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  collectPowerShellEntries,
  desktopPowerShellTabDefinition,
  desktopPowerShellTabDefinitions,
  DesktopPowerShell,
  DesktopPowerShellApprovalActions,
  DesktopPowerShellLauncher,
  DesktopPowerShellPanel,
  DESKTOP_POWERSHELL_TAB_KIND,
  DESKTOP_ROBOT_TERMINAL_TAB_KIND,
  hasSshPasswordPrompt,
  isPowerShellToolName,
  parsePowerShellCommand,
  terminalTargetForSelection,
  terminalTargetForMode,
  terminalTargetForSshProfile,
} from '../src/client/desktop-powershell.tsx'
import type { DesktopPowerShellApi } from '../src/client/desktop-powershell-api.ts'
import { createDesktopSshConnections } from '../src/client/desktop-ssh-connections.ts'
import { createDesktopTerminalShortcuts } from '../src/client/desktop-terminal-shortcuts.ts'
import { createRoboDeviceSelection } from '../src/client/robo-device-selection.ts'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function changeField(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
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

function sidebarRightHarness() {
  return {
    active: vi.fn(() => undefined),
    isExpanded: vi.fn(() => false),
    openTab: vi.fn(),
    toggleExpanded: vi.fn(),
  }
}

function visibleTabInfo() {
  return { sidebar: { expanded: true, fullscreen: false }, tab: { visible: true } } as never
}

function fullscreenTabInfo() {
  return { sidebar: { expanded: true, fullscreen: true }, tab: { visible: true } } as never
}

function renderFooterSlot(_name: string, owner: unknown) {
  return createElement(DesktopPowerShellApprovalActions, owner as never)
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
    expect(terminalTargetForMode('local', {
      modelId: 'robot-1', profileId: 'standard', ssh: { host: '192.0.2.20', user: 'robot' },
    }, 'Robot 1')).toEqual({ kind: 'local' })
    expect(terminalTargetForMode('robot', { modelId: '', profileId: '' }, '')).toBeUndefined()
    expect(terminalTargetForSshProfile({
      id: 'saved', label: 'Saved robot', host: '192.0.2.30', user: 'operator', port: 2222, lastConnectedAt: 1,
    }, { modelId: '', profileId: '' })).toEqual({
      kind: 'robot', modelId: 'saved:saved', profileId: 'manual-ssh', label: 'Saved robot',
      ssh: { host: '192.0.2.30', user: 'operator', port: 2222 },
    })
    expect(hasSshPasswordPrompt("operator@192.0.2.30's password: ")).toBe(true)
    expect(hasSshPasswordPrompt('password authentication is enabled')).toBe(false)
  })

  it('registers separate local and robot entries and opens the selected default from the title-bar entry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const [local, robot] = desktopPowerShellTabDefinitions()
    expect(local).toMatchObject({ kind: DESKTOP_POWERSHELL_TAB_KIND, title: expect.any(Function) })
    expect(robot).toMatchObject({ kind: DESKTOP_ROBOT_TERMINAL_TAB_KIND, title: expect.any(Function) })
    expect(local?.guide?.[0]?.title()).toMatch(/本机|device/i)
    expect(robot?.guide?.[0]?.title()).toMatch(/机器人|robot/i)
    expect(desktopPowerShellTabDefinition('robot').guide).toHaveLength(1)
    const sidebarRight = sidebarRightHarness()
    const device = createRoboDeviceSelection(new MemoryStorage())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(DesktopPowerShellLauncher, { sidebarRight, device })) })
      const launcher = container.querySelector('.dshDesktopPowerShellButton')
      if (!(launcher instanceof HTMLButtonElement)) throw new Error('terminal launcher missing')
      act(() => { launcher.click() })
      expect(sidebarRight.openTab).toHaveBeenCalledWith(DESKTOP_POWERSHELL_TAB_KIND)
      act(() => { device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' }) })
      act(() => { launcher.click() })
      expect(sidebarRight.openTab).toHaveBeenLastCalledWith(DESKTOP_ROBOT_TERMINAL_TAB_KIND)
    } finally {
      await act(async () => { root.unmount() })
      device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('keeps the local entry on this device and connects the robot entry through supplied SSH', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    const api = apiHarness()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'local', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      expect(api.open).toHaveBeenNthCalledWith(1, { kind: 'local' }, 120, 32, expect.any(AbortSignal))

      act(() => { device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' }) })
      await settle()
      expect(api.open).toHaveBeenCalledTimes(1)
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'robot', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      expect(api.open).toHaveBeenNthCalledWith(2, {
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
        ssh: { host: 'robot.local', user: 'operator' },
      }, 120, 32, expect.any(AbortSignal))
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('runs a quick command immediately or fills the command box for review', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    shortcuts.save([
      { id: 'run-location', label: '运行目录', command: 'Get-Location', behavior: 'run' },
      { id: 'fill-date', label: '填写日期', command: 'Get-Date', behavior: 'fill' },
    ])
    const api = apiHarness()
    api.read = vi.fn(async (): Promise<never> => await new Promise<never>(() => {}))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'local', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      const run = container.querySelector('[data-terminal-shortcut="run"]') as HTMLButtonElement
      const fill = container.querySelector('[data-terminal-shortcut="fill"]') as HTMLButtonElement
      act(() => { run.click() })
      expect(api.write).toHaveBeenCalledWith('session-1', 'Get-Location\r')
      act(() => { fill.click() })
      expect((container.querySelector('.dshDesktopPowerShellInput input') as HTMLInputElement).value).toBe('Get-Date')
      expect(api.write).toHaveBeenCalledTimes(1)
      act(() => { (container.querySelector('.dshDesktopTerminalShortcutSettings') as HTMLButtonElement).click() })
      expect(container.querySelector('.dshDesktopTerminalShortcutEditor')).not.toBeNull()
      const firstRow = container.querySelector('.dshDesktopTerminalShortcutRow') as HTMLDivElement
      const fields = firstRow.querySelectorAll('input')
      act(() => {
        changeField(fields[0] as HTMLInputElement, '查看位置')
        changeField(fields[1] as HTMLInputElement, 'pwd')
        changeField(firstRow.querySelector('select') as HTMLSelectElement, 'fill')
      })
      act(() => { (container.querySelector('.dshDesktopTerminalShortcutEditorActions button[data-primary]') as HTMLButtonElement).click() })
      expect(shortcuts.getSnapshot()[0]).toMatchObject({ label: '查看位置', command: 'pwd', behavior: 'fill' })
      expect(container.querySelector('.dshDesktopTerminalShortcutEditor')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('keeps quick buttons clickable before a terminal is ready and stages the command for review', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    shortcuts.save([{ id: 'run-location', label: '运行目录', command: 'Get-Location', behavior: 'run' }])
    const api = apiHarness()
    api.open = vi.fn(async (): Promise<never> => await new Promise<never>(() => {}))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'local', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      const run = container.querySelector('[data-terminal-shortcut="run"]') as HTMLButtonElement
      expect(run.disabled).toBe(false)
      act(() => { run.click() })
      expect((container.querySelector('.dshDesktopPowerShellInput input') as HTMLInputElement).value).toBe('Get-Location')
      expect(container.textContent).toMatch(/连接终端|Connect a terminal/i)
      expect(api.write).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('saves a manual robot profile without its password and submits the password only to an SSH prompt', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    device.select('robot-1', 'standard', 'Robot 1')
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connectionStorage = new MemoryStorage()
    const connections = createDesktopSshConnections(connectionStorage)
    const api = apiHarness()
    let reads = 0
    api.read = vi.fn(async (_sessionId, offset) => {
      if (reads++ === 0) return { output: "operator@192.0.2.44's password: ", offset: offset + 34, truncated: false, exited: false }
      return await new Promise<never>(() => {})
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'robot', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      const editor = container.querySelector('.dshDesktopSshEditor') as HTMLFormElement
      expect(editor).not.toBeNull()
      const fields = editor.querySelectorAll('input')
      act(() => {
        changeField(fields[0] as HTMLInputElement, 'Robot 1 lab')
        changeField(fields[1] as HTMLInputElement, '192.0.2.44')
        changeField(fields[2] as HTMLInputElement, 'operator')
        changeField(fields[3] as HTMLInputElement, '2222')
        changeField(fields[4] as HTMLInputElement, 'one-time-secret')
      })
      act(() => { (editor.querySelector('button[type="submit"]') as HTMLButtonElement).click() })
      await settle()
      expect(api.open).toHaveBeenCalledWith({
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1 lab',
        ssh: { host: '192.0.2.44', user: 'operator', port: 2222 },
      }, 120, 32, expect.any(AbortSignal))
      expect(api.write).toHaveBeenCalledWith('session-1', 'one-time-secret\r', expect.any(AbortSignal))
      expect(connectionStorage.value).not.toContain('one-time-secret')
      expect(connectionStorage.value).not.toContain('password')
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('shows MobaXterm-style saved connections in fullscreen and reconnects by clicking an IP entry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    connections.upsert({ id: 'saved-robot', label: 'Bumi lab', host: '192.0.2.88', user: 'ubuntu', port: 22, lastConnectedAt: 1 })
    const api = apiHarness()
    api.read = vi.fn(async (): Promise<never> => await new Promise<never>(() => {}))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'robot', shortcuts, connections, useTabInfo: fullscreenTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      expect(container.querySelector('.dshDesktopSshRail')).not.toBeNull()
      expect(container.querySelector('.dshDesktopSshCompact')).toBeNull()
      expect(container.querySelector('.dshDesktopSshProfile')?.textContent).toContain('192.0.2.88')
      act(() => { (container.querySelector('.dshDesktopSshProfileConnect') as HTMLButtonElement).click() })
      await settle()
      expect(api.open).toHaveBeenCalledWith({
        kind: 'robot', modelId: 'saved:saved-robot', profileId: 'manual-ssh', label: 'Bumi lab',
        ssh: { host: '192.0.2.88', user: 'ubuntu', port: 22 },
      }, 120, 32, expect.any(AbortSignal))
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('automatically opens for a pending PowerShell approval and exposes run and cancel', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' })
    const api = apiHarness()
    const answer = vi.fn(async () => {})
    const pending = { kind: 'approval', key: 'approval-1', toolName: 'pwsh', callId: 'call-1', reason: 'Review this command.', answer }
    const running = { callId: 'call-1', name: 'pwsh', argsRaw: '{"command":"Get-Date"}', turn: 1, step: 1, time: 10, subCalls: [] }
    const useChat = (selector: (snapshot: unknown) => unknown) => selector({ legacy: { nodes: [], runningCalls: [running] } })
    const usePending = (selector: (snapshot: Map<string, unknown>) => unknown) => selector(new Map([['session-1', pending]]))
    const sidebarRight = sidebarRightHarness()
    const renderSlot = vi.fn(renderFooterSlot)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement('div', null,
          createElement(DesktopPowerShellPanel, {
            device, api, mode: 'robot', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot,
          } as never),
          createElement(DesktopPowerShell, {
            sessionId: 'session-1', sidebarRight, device, useChat, useSessionPendingInteraction: usePending,
          } as never)))
      })
      await settle()
      expect(sidebarRight.openTab).toHaveBeenCalledWith(DESKTOP_ROBOT_TERMINAL_TAB_KIND)
      expect(container.querySelector('.dshDesktopPowerShellPanel')).not.toBeNull()
      expect(container.querySelector('.dshDesktopPowerShellApproval pre')?.textContent).toContain('Get-Date')
      expect(renderSlot).toHaveBeenCalledWith('desktop.powershell.footer.action', expect.objectContaining({
        pending, command: 'Get-Date', answer: expect.any(Function),
      }))
      const footer = container.querySelector('.dshDesktopPowerShellFooter')
      expect(footer).toBe(container.querySelector('.dshDesktopPowerShellSurface')?.lastElementChild)
      const buttons = [...container.querySelectorAll('.dshDesktopPowerShellFooter button')]
      expect(buttons).toHaveLength(2)
      act(() => { (buttons[1] as HTMLButtonElement).click() }); await settle()
      expect(answer).toHaveBeenCalledWith('allowed-once')
      act(() => { (buttons[0] as HTMLButtonElement).click() }); await settle()
      expect(answer).toHaveBeenCalledWith('rejected')
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })
})

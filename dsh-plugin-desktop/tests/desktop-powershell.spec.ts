// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  applyDesktopPowerShell,
  collectPowerShellEntries,
  createDesktopPowerShellNavigation,
  desktopPowerShellTabDefinition,
  desktopPowerShellTabDefinitions,
  DesktopPowerShell,
  DesktopPowerShellApprovalActions,
  DesktopPowerShellLauncher,
  DesktopPowerShellOverlay,
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

  it('registers separate local and robot entries on the guide page opened by the title-bar entry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const [local, robot] = desktopPowerShellTabDefinitions()
    expect(local).toMatchObject({ kind: DESKTOP_POWERSHELL_TAB_KIND, title: expect.any(Function) })
    expect(robot).toMatchObject({ kind: DESKTOP_ROBOT_TERMINAL_TAB_KIND, title: expect.any(Function) })
    expect(local?.guide?.[0]?.title()).toMatch(/本机|device/i)
    expect(robot?.guide?.[0]?.title()).toMatch(/机器人|robot/i)
    expect(desktopPowerShellTabDefinition('robot').guide).toHaveLength(1)
    const sidebarRight = sidebarRightHarness()
    const navigation = createDesktopPowerShellNavigation()
    const device = createRoboDeviceSelection(new MemoryStorage())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(DesktopPowerShellLauncher, { navigation })) })
      const launcher = container.querySelector('.dshDesktopPowerShellButton')
      if (!(launcher instanceof HTMLButtonElement)) throw new Error('terminal launcher missing')
      expect(launcher.disabled).toBe(false)
      let detach = (): void => {}
      act(() => { detach = navigation.attach(sidebarRight) })
      act(() => { launcher.click() })
      expect(sidebarRight.openTab).toHaveBeenCalledWith('guide')
      act(() => { device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' }) })
      act(() => { launcher.click() })
      expect(sidebarRight.openTab).toHaveBeenLastCalledWith('guide')
      act(() => { detach() })
      expect(launcher.disabled).toBe(false)
    } finally {
      await act(async () => { root.unmount() })
      device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('registers the title-bar launcher before right-Sidebar services become available', () => {
    localStorage.clear()
    const registrations: Array<{ readonly options: Record<string, unknown>; readonly occupant: unknown }> = []
    const injectors: Array<(ready: never) => void> = []
    const disposers: Array<() => void> = []
    const slots = {
      inject: vi.fn((_name: string, mount: () => unknown) => mount()),
      register: vi.fn((options: Record<string, unknown>, occupant: unknown) => {
        registrations.push({ options, occupant })
        return () => {}
      }),
    }
    const ctx = {
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      inject: vi.fn((_services: readonly string[], mount: (ready: never) => void) => { injectors.push(mount) }),
      slots,
    }
    const device = createRoboDeviceSelection(new MemoryStorage())
    try {
      applyDesktopPowerShell(ctx as never, device)
      expect(slots.inject).toHaveBeenCalledWith('shell.overlay', expect.any(Function))
      const launcher = registrations.find(entry => entry.options.name === 'shell.overlay')
      expect(launcher).toMatchObject({
        options: { id: 'desktop-powershell-launcher', order: 90 },
        occupant: DesktopPowerShellOverlay,
      })
      const injected = (launcher?.options.inject as (() => {
        navigation: ReturnType<typeof createDesktopPowerShellNavigation>
      }))()
      expect(injected.navigation.getSnapshot()).toBeUndefined()

      const sidebarRight = sidebarRightHarness()
      injectors[0]?.({
        ...ctx,
        sidebarRight,
        sidebarRightTabs: { register: vi.fn(() => () => {}) },
      } as never)
      expect(injected.navigation.getSnapshot()).toBe(sidebarRight)
    } finally {
      for (const dispose of disposers.reverse()) dispose()
      device.dispose()
    }
  })

  it('opens an application-level terminal when no session right-Sidebar is mounted', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const unavailableSidebar = sidebarRightHarness()
    unavailableSidebar.openTab.mockImplementation(() => { throw new Error('sidebarRight: no session surface is mounted') })
    const navigation = createDesktopPowerShellNavigation(() => unavailableSidebar)
    const device = createRoboDeviceSelection(new MemoryStorage())
    const shortcuts = createDesktopTerminalShortcuts(new MemoryStorage())
    const connections = createDesktopSshConnections(new MemoryStorage())
    const api = apiHarness()
    const layout = { openRightbar: vi.fn(), closeRightbar: vi.fn() }
    const container = document.createElement('div')
    const rightbarHost = document.createElement('aside')
    rightbarHost.className = 'dshDesktopRightbarSurface'
    document.body.append(container, rightbarHost)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(DesktopPowerShellOverlay, {
          navigation, device, api, resolveLayout: () => layout,
        }))
      })
      const launcher = container.querySelector('.dshDesktopPowerShellButton') as HTMLButtonElement
      expect(launcher.disabled).toBe(false)
      await act(async () => { launcher.click(); await Promise.resolve() })
      expect(unavailableSidebar.openTab).toHaveBeenCalledWith('guide')
      expect(navigation.getSnapshot()).toBe(unavailableSidebar)
      expect(layout.openRightbar).toHaveBeenCalledWith(true, false)
      const fallback = rightbarHost.querySelector('.dshDesktopPowerShellFallback') as HTMLElement
      expect(fallback).not.toBeNull()
      expect(fallback.querySelector('.dshDesktopPowerShellPanel')).toBeNull()
      const entries = fallback.querySelectorAll('.dshDesktopPowerShellEntry > div > button')
      expect(entries).toHaveLength(2)
      act(() => { (entries[0] as HTMLButtonElement).click() })
      expect(fallback.querySelector('.dshDesktopPowerShellPanel')?.getAttribute('data-terminal-mode')).toBe('local')
      const headerButtons = fallback.querySelectorAll('.dshDesktopPowerShellHeader button')
      act(() => { (headerButtons[1] as HTMLButtonElement).click() })
      expect(layout.openRightbar).toHaveBeenLastCalledWith(true, true)
      expect(fallback.getAttribute('data-fullscreen')).toBe('true')
      act(() => { (headerButtons[2] as HTMLButtonElement).click() })
      expect(layout.closeRightbar).toHaveBeenCalled()
      expect(rightbarHost.querySelector('.dshDesktopPowerShellFallback')).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); rightbarHost.remove(); vi.unstubAllGlobals()
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
      expect(container.querySelector('.dshDesktopPowerShellSurface')?.hasAttribute('data-connection-pane')).toBe(false)
      expect(container.querySelector('.dshDesktopPowerShellInput')).toBeNull()
      expect(container.querySelector('.dshDesktopTerminalShortcutArea')).toBeNull()

      act(() => { device.select('robot-1', 'standard', 'Robot 1', { host: 'robot.local', user: 'operator' }) })
      await settle()
      expect(api.open).toHaveBeenCalledTimes(1)
      await act(async () => {
        root.render(createElement(DesktopPowerShellPanel, {
          device, api, mode: 'robot', shortcuts, connections, useTabInfo: visibleTabInfo, renderSlot: renderFooterSlot,
        } as never))
      })
      await settle()
      expect(container.querySelector('.dshDesktopPowerShellSurface')?.hasAttribute('data-connection-pane')).toBe(false)
      expect(container.querySelector('.dshDesktopSshCompact')).toBeNull()
      expect(api.open).toHaveBeenNthCalledWith(2, {
        kind: 'robot', modelId: 'robot-1', profileId: 'standard', label: 'Robot 1',
        ssh: { host: 'robot.local', user: 'operator' },
      }, 120, 32, expect.any(AbortSignal))
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('keeps manual command controls out of the terminal display', async () => {
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
      expect(container.querySelector('.dshDesktopPowerShellInput')).toBeNull()
      expect(container.querySelector('.dshDesktopTerminalShortcutArea')).toBeNull()
      expect(api.write).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('shows only terminal status while a connection is starting', async () => {
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
      expect(container.querySelector('.dshDesktopPowerShellInput')).toBeNull()
      expect(container.querySelector('.dshDesktopTerminalShortcutArea')).toBeNull()
      expect(container.textContent).toMatch(/正在启动终端|Starting terminal/i)
      expect(api.write).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('uses robot selection data and does not put connection forms inside the terminal', async () => {
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
      expect(container.querySelector('.dshDesktopSshEditor')).toBeNull()
      expect(container.querySelector('.dshDesktopSshCompact')).toBeNull()
      expect(container.textContent).toMatch(/请先选择机器人|Select a robot/i)
      expect(api.open).not.toHaveBeenCalled()
      expect(connectionStorage.value).toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      connections.dispose(); shortcuts.dispose(); device.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('keeps saved connection management out of the fullscreen terminal', async () => {
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
      expect(container.querySelector('.dshDesktopSshRail')).toBeNull()
      expect(container.querySelector('.dshDesktopSshCompact')).toBeNull()
      expect(container.querySelector('.dshDesktopSshProfile')).toBeNull()
      expect(container.querySelector('.dshDesktopPowerShellInput')).toBeNull()
      expect(api.open).not.toHaveBeenCalled()
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

import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopTerminalShortcuts,
  DEFAULT_DESKTOP_TERMINAL_SHORTCUTS,
  DESKTOP_TERMINAL_SHORTCUT_LIMIT,
  parseDesktopTerminalShortcuts,
} from '../src/client/desktop-terminal-shortcuts.ts'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

describe('Desktop terminal shortcuts', () => {
  it('loads safe defaults and rejects malformed persisted commands', () => {
    expect(parseDesktopTerminalShortcuts(null)).toEqual(DEFAULT_DESKTOP_TERMINAL_SHORTCUTS)
    expect(parseDesktopTerminalShortcuts('[{"id":"bad","label":"bad","command":"line\\nbreak","behavior":"run"}]'))
      .toEqual(DEFAULT_DESKTOP_TERMINAL_SHORTCUTS)
    expect(parseDesktopTerminalShortcuts(JSON.stringify(Array.from({ length: DESKTOP_TERMINAL_SHORTCUT_LIMIT + 1 }, (_, id) => ({
      id: String(id), label: 'x', command: 'pwd', behavior: 'run',
    }))))).toEqual(DEFAULT_DESKTOP_TERMINAL_SHORTCUTS)
  })

  it('persists edits, publishes updates, validates input, and restores defaults', () => {
    const storage = new MemoryStorage()
    const shortcuts = createDesktopTerminalShortcuts(storage)
    const listener = vi.fn()
    shortcuts.subscribe(listener)
    const custom = [{ id: 'logs', label: '日志', command: 'Get-Content app.log', behavior: 'fill' as const }]
    shortcuts.save(custom)
    expect(shortcuts.getSnapshot()).toEqual(custom)
    expect(JSON.parse(storage.value ?? '')).toEqual(custom)
    expect(listener).toHaveBeenCalledOnce()
    expect(() => shortcuts.save([{ id: 'bad', label: '', command: 'pwd', behavior: 'run' }])).toThrow('名称或命令无效')
    shortcuts.reset()
    expect(shortcuts.getSnapshot()).toEqual(DEFAULT_DESKTOP_TERMINAL_SHORTCUTS)
    shortcuts.dispose()
  })
})

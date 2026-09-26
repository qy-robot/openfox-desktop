/** Durable user-defined command buttons shared by local and robot terminals. */

const STORAGE_KEY = 'openfox-terminal-shortcuts-v1'
export const DESKTOP_TERMINAL_SHORTCUT_LIMIT = 12

export type DesktopTerminalShortcutBehavior = 'run' | 'fill'

export interface DesktopTerminalShortcut {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly behavior: DesktopTerminalShortcutBehavior
}

export interface DesktopTerminalShortcuts {
  getSnapshot(): readonly DesktopTerminalShortcut[]
  subscribe(listener: () => void): () => void
  save(shortcuts: readonly DesktopTerminalShortcut[]): void
  reset(): void
  dispose(): void
}

type ShortcutStorage = Pick<Storage, 'getItem' | 'setItem'>

export const DEFAULT_DESKTOP_TERMINAL_SHORTCUTS: readonly DesktopTerminalShortcut[] = Object.freeze([
  Object.freeze({ id: 'clear', label: '清屏', command: 'clear', behavior: 'run' }),
  Object.freeze({ id: 'pwd', label: '当前目录', command: 'pwd', behavior: 'run' }),
  Object.freeze({ id: 'list', label: '文件列表', command: 'ls', behavior: 'run' }),
])

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}

function parseShortcut(value: unknown): DesktopTerminalShortcut | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!validText(record.id, 100) || !validText(record.label, 16) || !validText(record.command, 2_000)) return undefined
  if (record.behavior !== 'run' && record.behavior !== 'fill') return undefined
  return Object.freeze({ id: record.id, label: record.label, command: record.command, behavior: record.behavior })
}

export function parseDesktopTerminalShortcuts(value: string | null): readonly DesktopTerminalShortcut[] {
  if (value === null) return DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length > DESKTOP_TERMINAL_SHORTCUT_LIMIT) return DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
    const shortcuts = parsed.map(parseShortcut)
    if (shortcuts.some(shortcut => shortcut === undefined)) return DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
    const resolved = shortcuts as DesktopTerminalShortcut[]
    if (new Set(resolved.map(shortcut => shortcut.id)).size !== resolved.length) return DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
    return Object.freeze(resolved)
  } catch {
    return DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
  }
}

function validateShortcuts(shortcuts: readonly DesktopTerminalShortcut[]): readonly DesktopTerminalShortcut[] {
  if (shortcuts.length > DESKTOP_TERMINAL_SHORTCUT_LIMIT) throw new Error(`最多只能添加 ${String(DESKTOP_TERMINAL_SHORTCUT_LIMIT)} 个快捷按键。`)
  const resolved = shortcuts.map(parseShortcut)
  if (resolved.some(shortcut => shortcut === undefined)) throw new Error('按键名称或命令无效，请检查后重试。')
  const valid = resolved as DesktopTerminalShortcut[]
  if (new Set(valid.map(shortcut => shortcut.id)).size !== valid.length) throw new Error('快捷按键标识重复，请删除重复项。')
  return Object.freeze(valid)
}

function defaultStorage(): ShortcutStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function createDesktopTerminalShortcuts(storage?: ShortcutStorage): DesktopTerminalShortcuts {
  const resolvedStorage = storage ?? defaultStorage()
  let snapshot = DEFAULT_DESKTOP_TERMINAL_SHORTCUTS
  try { snapshot = parseDesktopTerminalShortcuts(resolvedStorage?.getItem(STORAGE_KEY) ?? null) } catch {}
  const listeners = new Set<() => void>()
  let active = true

  const publish = (next: readonly DesktopTerminalShortcut[]) => {
    if (!active || snapshot === next) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const persist = (next: readonly DesktopTerminalShortcut[]) => {
    if (resolvedStorage === undefined) throw new Error('无法保存快捷按键，请检查本地存储权限。')
    try { resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(next)) }
    catch { throw new Error('快捷按键未能保存到本机，请检查存储空间或权限。') }
  }
  const nativeStorage = storage === undefined ? resolvedStorage : undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || (event.storageArea && event.storageArea !== nativeStorage)) return
    publish(parseDesktopTerminalShortcuts(event.newValue))
  }
  if (typeof window !== 'undefined' && nativeStorage) window.addEventListener('storage', onStorage)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (!active) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    save(shortcuts) { const next = validateShortcuts(shortcuts); persist(next); publish(next) },
    reset() { const next = DEFAULT_DESKTOP_TERMINAL_SHORTCUTS; persist(next); publish(next) },
    dispose() {
      if (!active) return
      active = false; listeners.clear()
      if (typeof window !== 'undefined' && nativeStorage) window.removeEventListener('storage', onStorage)
    },
  }
}

/** Durable SSH connection history. Passwords are intentionally never stored. */

const STORAGE_KEY = 'openfox-ssh-connections-v1'
export const DESKTOP_SSH_CONNECTION_LIMIT = 30

export interface DesktopSshProfile {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly user?: string
  readonly port?: number
  readonly modelId?: string
  readonly profileId?: string
  readonly lastConnectedAt: number
}

export interface DesktopSshConnections {
  getSnapshot(): readonly DesktopSshProfile[]
  subscribe(listener: () => void): () => void
  upsert(profile: DesktopSshProfile): void
  remove(id: string): void
  dispose(): void
}

type ConnectionStorage = Pick<Storage, 'getItem' | 'setItem'>

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) return undefined
  return value
}

function parseProfile(value: unknown): DesktopSshProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = optionalText(record.id, 100)
  const label = optionalText(record.label, 80)
  const host = optionalText(record.host, 253)
  const user = optionalText(record.user, 128)
  const modelId = optionalText(record.modelId, 129)
  const profileId = optionalText(record.profileId, 128)
  const port = record.port === undefined ? undefined : record.port
  if (id === undefined || label === undefined || host === undefined || host.startsWith('-')
    || !/^[A-Za-z0-9._:[\]%-]+$/u.test(host)) return undefined
  if (record.user !== undefined && user === undefined) return undefined
  if (user !== undefined && (user.startsWith('-') || !/^[A-Za-z0-9._-]+$/u.test(user))) return undefined
  if (record.modelId !== undefined && modelId === undefined) return undefined
  if (record.profileId !== undefined && profileId === undefined) return undefined
  if (port !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65_535)) return undefined
  if (typeof record.lastConnectedAt !== 'number' || !Number.isSafeInteger(record.lastConnectedAt) || record.lastConnectedAt < 0) return undefined
  return Object.freeze({ id, label, host, lastConnectedAt: record.lastConnectedAt,
    ...(user === undefined ? {} : { user }), ...(port === undefined ? {} : { port: port as number }),
    ...(modelId === undefined ? {} : { modelId }), ...(profileId === undefined ? {} : { profileId }) })
}

export function parseDesktopSshConnections(value: string | null): readonly DesktopSshProfile[] {
  if (value === null) return Object.freeze([])
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length > DESKTOP_SSH_CONNECTION_LIMIT) return Object.freeze([])
    const profiles = parsed.map(parseProfile)
    if (profiles.some(profile => profile === undefined)) return Object.freeze([])
    const resolved = profiles as DesktopSshProfile[]
    if (new Set(resolved.map(profile => profile.id)).size !== resolved.length) return Object.freeze([])
    return Object.freeze(resolved.sort((left, right) => right.lastConnectedAt - left.lastConnectedAt))
  } catch { return Object.freeze([]) }
}

function defaultStorage(): ConnectionStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function createDesktopSshConnections(storage?: ConnectionStorage): DesktopSshConnections {
  const resolvedStorage = storage ?? defaultStorage()
  let snapshot: readonly DesktopSshProfile[] = Object.freeze([])
  try { snapshot = parseDesktopSshConnections(resolvedStorage?.getItem(STORAGE_KEY) ?? null) } catch {}
  const listeners = new Set<() => void>()
  let active = true
  const publish = (next: readonly DesktopSshProfile[]) => {
    if (!active) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const persist = (next: readonly DesktopSshProfile[]) => {
    if (resolvedStorage === undefined) throw new Error('无法保存 SSH 连接记录，请检查本地存储权限。')
    try { resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(next)) }
    catch { throw new Error('SSH 连接记录未能保存到本机，请检查存储空间或权限。') }
  }
  const commit = (next: readonly DesktopSshProfile[]) => { persist(next); publish(next) }
  const nativeStorage = storage === undefined ? resolvedStorage : undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || (event.storageArea && event.storageArea !== nativeStorage)) return
    publish(parseDesktopSshConnections(event.newValue))
  }
  if (typeof window !== 'undefined' && nativeStorage) window.addEventListener('storage', onStorage)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (!active) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    upsert(profile) {
      const valid = parseProfile(profile)
      if (valid === undefined) throw new Error('SSH 连接信息无效，请检查名称、IP、端口和用户名。')
      const next = [valid, ...snapshot.filter(item => item.id !== valid.id)]
        .sort((left, right) => right.lastConnectedAt - left.lastConnectedAt).slice(0, DESKTOP_SSH_CONNECTION_LIMIT)
      commit(Object.freeze(next))
    },
    remove(id) { commit(Object.freeze(snapshot.filter(profile => profile.id !== id))) },
    dispose() {
      if (!active) return
      active = false; listeners.clear()
      if (typeof window !== 'undefined' && nativeStorage) window.removeEventListener('storage', onStorage)
    },
  }
}

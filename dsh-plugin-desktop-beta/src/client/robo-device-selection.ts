import type { RoboCatalog } from './robo-skills-api.ts'
import type { DesktopSshConnection } from '../desktop-powershell-contract.ts'

const STORAGE_KEY = 'robocoding-current-device-v1'

export interface RoboDeviceSelectionSnapshot {
  readonly modelId: string
  readonly profileId: string
  readonly ssh?: DesktopSshConnection
}

export interface RoboDeviceSelection {
  getSnapshot(): RoboDeviceSelectionSnapshot
  getModelLabel(): string
  subscribe(listener: () => void): () => void
  select(modelId: string, profileId: string, modelLabel?: string, ssh?: DesktopSshConnection): void
  clear(): void
  reconcile(catalog: RoboCatalog): boolean
  dispose(): void
}

type RoboDeviceStorage = Pick<Storage, 'getItem' | 'setItem'>

const EMPTY: RoboDeviceSelectionSnapshot = Object.freeze({ modelId: '', profileId: '' })
export const EMPTY_ROBO_DEVICE_SELECTION: RoboDeviceSelection = Object.freeze({
  getSnapshot: () => EMPTY,
  getModelLabel: () => '',
  subscribe: () => () => {},
  select: () => { throw new Error('设备型号选择器不可用。') },
  clear: () => {},
  reconcile: () => false,
  dispose: () => {},
})

function validId(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) return undefined
  return value
}

function sameSsh(left: DesktopSshConnection | undefined, right: DesktopSshConnection | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.host === right.host && left.user === right.user && left.port === right.port
    && left.identityFile === right.identityFile)
}

/** Parse the structured SSH target populated by robot selection. */
export function parseRoboSshConnection(value: unknown): DesktopSshConnection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const host = optionalText(record.host, 253)
  const user = optionalText(record.user, 128)
  const identityFile = optionalText(record.identityFile, 4096)
  const port = record.port === undefined ? undefined : record.port
  if (host === undefined || host.startsWith('-') || /\s/u.test(host)) return undefined
  if (record.user !== undefined && user === undefined) return undefined
  if (record.identityFile !== undefined && identityFile === undefined) return undefined
  if (port !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65_535)) return undefined
  return { host, ...(user === undefined ? {} : { user }), ...(port === undefined ? {} : { port: port as number }),
    ...(identityFile === undefined ? {} : { identityFile }) }
}

/** Resolve an SSH block from profile/model configuration without inventing connection data. */
export function roboSshConnectionFromConfiguration(
  ...configurations: readonly (Readonly<Record<string, unknown>> | undefined)[]
): DesktopSshConnection | undefined {
  for (const configuration of configurations) {
    if (configuration === undefined) continue
    const direct = parseRoboSshConnection(configuration.ssh)
    if (direct !== undefined) return direct
    const terminal = configuration.terminal
    if (terminal && typeof terminal === 'object' && !Array.isArray(terminal)
      && (terminal as Record<string, unknown>).kind === 'ssh') {
      const nested = parseRoboSshConnection(terminal)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function parseStored(value: string | null): { readonly snapshot: RoboDeviceSelectionSnapshot; readonly modelLabel: string } {
  if (value === null) return { snapshot: EMPTY, modelLabel: '' }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { snapshot: EMPTY, modelLabel: '' }
    const record = parsed as Record<string, unknown>
    if (!validId(record.modelId, 129) || !validId(record.profileId, 128)) return { snapshot: EMPTY, modelLabel: '' }
    const ssh = record.ssh === undefined ? undefined : parseRoboSshConnection(record.ssh)
    if (record.ssh !== undefined && ssh === undefined) return { snapshot: EMPTY, modelLabel: '' }
    const storedLabel = typeof record.modelLabel === 'string' ? record.modelLabel.trim() : ''
    return { snapshot: Object.freeze({ modelId: record.modelId, profileId: record.profileId,
      ...(ssh === undefined ? {} : { ssh }) }), modelLabel: storedLabel.length <= 100 ? storedLabel : '' }
  } catch {
    return { snapshot: EMPTY, modelLabel: '' }
  }
}

function defaultStorage(): RoboDeviceStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

/** Durable device-model and development-method choice used to filter compatible skills. */
export function createRoboDeviceSelection(storage?: RoboDeviceStorage): RoboDeviceSelection {
  const resolvedStorage = storage ?? defaultStorage()
  let snapshot = EMPTY
  let modelLabel = ''
  try { const stored = parseStored(resolvedStorage?.getItem(STORAGE_KEY) ?? null); snapshot = stored.snapshot; modelLabel = stored.modelLabel } catch { /* Desktop must still open. */ }
  const listeners = new Set<() => void>()
  let active = true

  const publish = (next: RoboDeviceSelectionSnapshot, nextLabel = '') => {
    if (!active || (snapshot.modelId === next.modelId && snapshot.profileId === next.profileId
      && sameSsh(snapshot.ssh, next.ssh) && modelLabel === nextLabel)) return
    snapshot = next
    modelLabel = nextLabel
    for (const listener of listeners) listener()
  }
  const persist = (next: RoboDeviceSelectionSnapshot, nextLabel = '') => {
    if (!resolvedStorage) throw new Error('无法保存设备型号，请检查本地存储权限后重试。')
    try { resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(nextLabel ? { ...next, modelLabel: nextLabel } : next)) }
    catch { throw new Error('设备型号未能保存到本机，请检查存储空间或权限后重试。') }
  }
  const nativeStorage = storage === undefined ? resolvedStorage : undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || (event.storageArea && event.storageArea !== nativeStorage)) return
    const stored = parseStored(event.newValue)
    publish(stored.snapshot, stored.modelLabel)
  }
  if (typeof window !== 'undefined' && nativeStorage) window.addEventListener('storage', onStorage)

  const selection: RoboDeviceSelection = {
    getSnapshot: () => snapshot,
    getModelLabel: () => modelLabel,
    subscribe(listener) { if (!active) return () => {}; listeners.add(listener); return () => { listeners.delete(listener) } },
    select(modelId, profileId, requestedModelLabel, ssh) {
      if (!validId(modelId, 129) || !validId(profileId, 128)) throw new Error('请选择有效的设备型号和开发方式。')
      if (ssh !== undefined && parseRoboSshConnection(ssh) === undefined) throw new Error('机器人 SSH 连接信息无效。')
      const next = Object.freeze({ modelId, profileId, ...(ssh === undefined ? {} : { ssh: { ...ssh } }) })
      const nextLabel = typeof requestedModelLabel === 'string' ? requestedModelLabel.trim().slice(0, 100) : ''
      persist(next, nextLabel); publish(next, nextLabel)
    },
    clear() { persist(EMPTY); publish(EMPTY, '') },
    reconcile(catalog) {
      if (!snapshot.modelId) return false
      const robot = catalog.robots.find(item => item.id === snapshot.modelId)
      const profile = robot?.profiles.find(item => item.id === snapshot.profileId)
      if (robot === undefined || profile === undefined) {
        selection.clear()
        return true
      }
      const ssh = roboSshConnectionFromConfiguration(profile.configuration, robot.configuration)
      if (!sameSsh(snapshot.ssh, ssh)) {
        const next = Object.freeze({ modelId: snapshot.modelId, profileId: snapshot.profileId,
          ...(ssh === undefined ? {} : { ssh: { ...ssh } }) })
        persist(next, modelLabel); publish(next, modelLabel)
      }
      return false
    },
    dispose() {
      if (!active) return
      active = false; listeners.clear()
      if (typeof window !== 'undefined' && nativeStorage) window.removeEventListener('storage', onStorage)
    },
  }
  return selection
}

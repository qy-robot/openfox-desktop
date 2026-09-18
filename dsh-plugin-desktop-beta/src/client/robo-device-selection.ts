import type { RoboCatalog } from './robo-skills-api.ts'

const STORAGE_KEY = 'robocoding-current-device-v1'

export interface RoboDeviceSelectionSnapshot {
  readonly modelId: string
  readonly profileId: string
}

export interface RoboDeviceSelection {
  getSnapshot(): RoboDeviceSelectionSnapshot
  getModelLabel(): string
  subscribe(listener: () => void): () => void
  select(modelId: string, profileId: string, modelLabel?: string): void
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

function parseStored(value: string | null): { readonly snapshot: RoboDeviceSelectionSnapshot; readonly modelLabel: string } {
  if (value === null) return { snapshot: EMPTY, modelLabel: '' }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { snapshot: EMPTY, modelLabel: '' }
    const record = parsed as Record<string, unknown>
    if (!validId(record.modelId, 129) || !validId(record.profileId, 128)) return { snapshot: EMPTY, modelLabel: '' }
    const storedLabel = typeof record.modelLabel === 'string' ? record.modelLabel.trim() : ''
    return { snapshot: Object.freeze({ modelId: record.modelId, profileId: record.profileId }), modelLabel: storedLabel.length <= 100 ? storedLabel : '' }
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
    if (!active || (snapshot.modelId === next.modelId && snapshot.profileId === next.profileId && modelLabel === nextLabel)) return
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
    select(modelId, profileId, requestedModelLabel) {
      if (!validId(modelId, 129) || !validId(profileId, 128)) throw new Error('请选择有效的设备型号和开发方式。')
      const next = Object.freeze({ modelId, profileId })
      const nextLabel = typeof requestedModelLabel === 'string' ? requestedModelLabel.trim().slice(0, 100) : ''
      persist(next, nextLabel); publish(next, nextLabel)
    },
    clear() { persist(EMPTY); publish(EMPTY, '') },
    reconcile(catalog) {
      if (!snapshot.modelId) return false
      const robot = catalog.robots.find(item => item.id === snapshot.modelId)
      if (robot?.profiles.some(profile => profile.id === snapshot.profileId)) return false
      selection.clear()
      return true
    },
    dispose() {
      if (!active) return
      active = false; listeners.clear()
      if (typeof window !== 'undefined' && nativeStorage) window.removeEventListener('storage', onStorage)
    },
  }
  return selection
}

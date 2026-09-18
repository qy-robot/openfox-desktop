import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

const STORAGE_KEY = 'robo-skills-library-v1'
const MAX_SKILLS = 2000
const MAX_SKILL_ID_LENGTH = 64

type RoboSkillStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface RoboSkillLibrary {
  getSnapshot(): readonly string[]
  subscribe(listener: () => void): () => void
  add(id: string): boolean | Promise<boolean>
  remove(id: string): boolean | Promise<boolean>
  dispose(): void
}

export interface RoboHostSkillLibrarySettings { readonly skillIds: readonly string[] }

function validSkillId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SKILL_ID_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function parseStoredSkills(value: string | null): readonly string[] {
  if (value === null) return Object.freeze([])
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length > MAX_SKILLS) return Object.freeze([])
    const skills = [...new Set(parsed.filter(validSkillId))]
    return Object.freeze(skills)
  } catch {
    return Object.freeze([])
  }
}

function sameSkills(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function validSkills(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_SKILLS || value.some(id => !validSkillId(id))) return Object.freeze([])
  return Object.freeze([...new Set(value)])
}

function defaultStorage(): RoboSkillStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function createRoboSkillLibrary(storage?: RoboSkillStorage): RoboSkillLibrary {
  const resolvedStorage = storage ?? defaultStorage()
  let snapshot: readonly string[] = Object.freeze([])
  try {
    snapshot = parseStoredSkills(resolvedStorage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    // A denied or damaged local store must not prevent Desktop from opening.
  }

  const listeners = new Set<() => void>()
  let active = true

  const publish = (next: readonly string[]) => {
    if (!active || sameSkills(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const persist = (next: readonly string[]) => {
    if (!resolvedStorage) throw new Error('无法保存技能，请检查本地存储权限后重试。')
    try {
      resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      throw new Error('技能未能保存到本机，请检查存储空间或权限后重试。')
    }
  }

  const nativeStorage = storage === undefined ? resolvedStorage : undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || (event.storageArea && event.storageArea !== nativeStorage)) return
    publish(parseStoredSkills(event.newValue))
  }
  if (typeof window !== 'undefined' && nativeStorage) window.addEventListener('storage', onStorage)

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!active) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    add(id) {
      if (!validSkillId(id)) throw new Error(`无效的技能标识：请输入 1 至 ${MAX_SKILL_ID_LENGTH} 个有效字符。`)
      if (snapshot.includes(id)) return false
      if (snapshot.length >= MAX_SKILLS) throw new Error(`最多只能添加 ${MAX_SKILLS} 个技能。`)
      const next = Object.freeze([...snapshot, id])
      persist(next)
      publish(next)
      return true
    },
    remove(id) {
      if (!validSkillId(id)) throw new Error('无效的技能标识。')
      if (!snapshot.includes(id)) return false
      const next = Object.freeze(snapshot.filter(item => item !== id))
      persist(next)
      publish(next)
      return true
    },
    dispose() {
      if (!active) return
      active = false
      listeners.clear()
      if (typeof window !== 'undefined' && nativeStorage) window.removeEventListener('storage', onStorage)
    },
  }
}

/** Durable per-machine skill choices backed by the Host settings document. */
export function createRoboHostSkillLibrary(scope: SettingsScope<RoboHostSkillLibrarySettings>): RoboSkillLibrary {
  const read = () => {
    const current = scope.getSnapshot()
    return current.status === 'ready' && current.mode === 'host' ? validSkills(current.value?.skillIds) : undefined
  }
  let snapshot = read() ?? Object.freeze([]) as readonly string[]
  const listeners = new Set<() => void>()
  let active = true
  let writes: Promise<void> = Promise.resolve()

  const publishFromScope = () => {
    if (!active) return
    const next = read()
    if (!next || sameSkills(snapshot, next)) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const unsubscribe = scope.subscribe(() => { publishFromScope() })

  const mutate = (kind: 'add' | 'remove', id: string): Promise<boolean> => {
    if (!validSkillId(id)) return Promise.reject(new Error('无效的技能标识。'))
    if (!active) return Promise.reject(new Error('技能库已关闭，请重新打开页面后重试。'))
    const operation = writes.then(async () => {
      if (!active) throw new Error('技能库已关闭，请重新打开页面后重试。')
      const current = scope.getSnapshot()
      if (current.status !== 'ready' || current.mode !== 'host' || !current.writable || current.revision === undefined) {
        throw new Error('技能库暂时无法保存，请等待本地服务连接后重试。')
      }
      const ids = validSkills(current.value?.skillIds)
      const exists = ids.includes(id)
      if ((kind === 'add' && exists) || (kind === 'remove' && !exists)) return false
      if (kind === 'add' && ids.length >= MAX_SKILLS) throw new Error(`最多只能添加 ${MAX_SKILLS} 个技能。`)
      const next = kind === 'add' ? [...ids, id] : ids.filter(item => item !== id)
      try {
        await scope.mutate([{ op: 'set', path: ['skillIds'], value: next }], current.revision)
      } catch {
        throw new Error('技能未能保存到本机，请检查本地服务后重试。')
      }
      if (!active) throw new Error('技能库已关闭，请重新打开页面后重试。')
      const confirmed = scope.getSnapshot()
      if (confirmed.status !== 'ready' || confirmed.mode !== 'host'
        || !sameSkills(validSkills(confirmed.value?.skillIds), next)) {
        throw new Error('技能库已在其他窗口更新，请刷新后重试。')
      }
      publishFromScope()
      return true
    })
    writes = operation.then(() => undefined, () => undefined)
    return operation
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (!active) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    add: id => mutate('add', id),
    remove: id => mutate('remove', id),
    dispose() {
      if (!active) return
      active = false
      unsubscribe()
      listeners.clear()
    },
  }
}

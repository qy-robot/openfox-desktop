// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  createRoboHostSkillLibrary,
  createRoboSkillLibrary,
  type RoboHostSkillLibrarySettings,
} from '../src/client/robo-skills-library.ts'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null
  constructor(value: string | null = null) { this.value = value }
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

class HostSkillScope {
  state: SettingsScopeSnapshot<RoboHostSkillLibrarySettings>
  readonly listeners = new Set<() => void>()
  readonly mutations: Array<{ readonly value: readonly string[]; readonly expectedRevision?: number }> = []
  rejectWrites = false
  ignoreWrites = false
  beforeCommit: (() => Promise<void>) | undefined

  constructor(status: 'loading' | 'ready' = 'ready', skillIds: readonly string[] = [], revision = 4) {
    this.state = { status, value: status === 'ready' ? { skillIds } : undefined, base: {}, user: {},
      revision: status === 'ready' ? revision : undefined, writable: status === 'ready', mode: 'host' }
  }
  getSnapshot() { return this.state }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async mutate(ops: readonly { readonly op: string; readonly path: readonly (string | number)[]; readonly value?: unknown }[], expectedRevision?: number) {
    const value = ops[0]?.value as readonly string[]
    this.mutations.push({ value, ...(expectedRevision === undefined ? {} : { expectedRevision }) })
    if (this.rejectWrites) throw new Error('disk offline')
    await this.beforeCommit?.()
    if (this.ignoreWrites || expectedRevision !== this.state.revision) return
    this.state = { ...this.state, value: { skillIds: [...value] }, revision: (this.state.revision ?? 0) + 1 }
    this.emit()
  }
  async set(): Promise<void> { throw new Error('unexpected set') }
  async unset(): Promise<void> { throw new Error('unexpected unset') }
  hydrate(skillIds: readonly string[], revision = 4) {
    this.state = { status: 'ready', value: { skillIds }, base: {}, user: {}, revision, writable: true, mode: 'host' }
    this.emit()
  }
  externalUpdate(skillIds: readonly string[]) {
    this.state = { ...this.state, value: { skillIds }, revision: (this.state.revision ?? 0) + 1 }
    this.emit()
  }
  setLoading() {
    this.state = { ...this.state, status: 'loading', value: undefined, writable: false }
    this.emit()
  }
  private emit() { for (const listener of this.listeners) listener() }
  asScope() { return this as unknown as SettingsScope<RoboHostSkillLibrarySettings> }
}

describe('Robo skill library', () => {
  it('starts empty and persists additions across reloads', () => {
    const storage = new MemoryStorage()
    const library = createRoboSkillLibrary(storage)
    const listener = vi.fn()
    library.subscribe(listener)

    expect(library.getSnapshot()).toEqual([])
    expect(library.add('navigation-diagnostics')).toBe(true)
    expect(library.getSnapshot()).toEqual(['navigation-diagnostics'])
    expect(listener).toHaveBeenCalledOnce()
    expect(storage.setItem).toHaveBeenCalledWith('robo-skills-library-v1', '["navigation-diagnostics"]')

    const reloaded = createRoboSkillLibrary(storage)
    expect(reloaded.getSnapshot()).toEqual(['navigation-diagnostics'])
    library.dispose()
    reloaded.dispose()
  })

  it('deduplicates additions and persists removals', () => {
    const storage = new MemoryStorage('["ros-log-summary"]')
    const library = createRoboSkillLibrary(storage)
    const initial = library.getSnapshot()

    expect(library.add('ros-log-summary')).toBe(false)
    expect(library.getSnapshot()).toBe(initial)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(library.remove('ros-log-summary')).toBe(true)
    expect(library.getSnapshot()).toEqual([])
    expect(storage.value).toBe('[]')
    expect(library.remove('ros-log-summary')).toBe(false)
    library.dispose()
  })

  it('recovers safely from malformed or partly invalid stored data', () => {
    expect(createRoboSkillLibrary(new MemoryStorage('{broken')).getSnapshot()).toEqual([])
    expect(createRoboSkillLibrary(new MemoryStorage('{"skills":[]}')).getSnapshot()).toEqual([])
    expect(createRoboSkillLibrary(new MemoryStorage('["ok","ok","",42," bad"]')).getSnapshot()).toEqual(['ok'])
    const unreadable = new MemoryStorage()
    unreadable.getItem.mockImplementation(() => { throw new Error('denied') })
    expect(createRoboSkillLibrary(unreadable).getSnapshot()).toEqual([])
  })

  it('does not publish an addition when persistence fails', () => {
    const storage = new MemoryStorage()
    storage.setItem.mockImplementation(() => { throw new Error('quota') })
    const library = createRoboSkillLibrary(storage)
    const listener = vi.fn()
    library.subscribe(listener)

    expect(() => library.add('arm-inspection')).toThrow('技能未能保存到本机')
    expect(library.getSnapshot()).toEqual([])
    expect(listener).not.toHaveBeenCalled()
    library.dispose()
  })

  it('validates skill IDs before writing', () => {
    const storage = new MemoryStorage()
    const library = createRoboSkillLibrary(storage)
    expect(() => library.add('')).toThrow('无效的技能标识')
    expect(() => library.add(`skill-${'x'.repeat(64)}`)).toThrow('无效的技能标识')
    expect(storage.setItem).not.toHaveBeenCalled()
    library.dispose()
  })
})

describe('Host-backed Robo skill library', () => {
  it('hydrates through class-bound scope methods and follows cross-instance updates', async () => {
    const scope = new HostSkillScope('loading')
    const first = createRoboHostSkillLibrary(scope.asScope())
    const changed = vi.fn()
    first.subscribe(changed)
    expect(first.getSnapshot()).toEqual([])

    scope.hydrate(['navigation-diagnostics'])
    expect(first.getSnapshot()).toEqual(['navigation-diagnostics'])
    expect(Object.isFrozen(first.getSnapshot())).toBe(true)
    const second = createRoboHostSkillLibrary(scope.asScope())
    expect(second.getSnapshot()).toEqual(['navigation-diagnostics'])

    scope.setLoading()
    expect(first.getSnapshot()).toEqual(['navigation-diagnostics'])
    expect(second.getSnapshot()).toEqual(['navigation-diagnostics'])
    scope.hydrate(['navigation-diagnostics'], 4)

    await expect(second.add('ros-log-summary')).resolves.toBe(true)
    expect(first.getSnapshot()).toEqual(['navigation-diagnostics', 'ros-log-summary'])
    expect(changed).toHaveBeenCalledTimes(2)
    first.dispose(); second.dispose()
  })

  it('publishes only after durable CAS confirmation and serializes its writes', async () => {
    const scope = new HostSkillScope()
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    scope.beforeCommit = () => held
    const library = createRoboHostSkillLibrary(scope.asScope())
    const changed = vi.fn()
    library.subscribe(changed)

    const first = library.add('navigation-diagnostics')
    const second = library.add('ros-log-summary')
    await Promise.resolve()
    expect(library.getSnapshot()).toEqual([])
    expect(scope.mutations).toHaveLength(1)
    release()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(scope.mutations).toEqual([
      { value: ['navigation-diagnostics'], expectedRevision: 4 },
      { value: ['navigation-diagnostics', 'ros-log-summary'], expectedRevision: 5 },
    ])
    expect(library.getSnapshot()).toEqual(['navigation-diagnostics', 'ros-log-summary'])
    expect(changed).toHaveBeenCalledTimes(2)
    library.dispose()
  })

  it('does not fake success after rejected, unavailable, or stale writes', async () => {
    const rejectedScope = new HostSkillScope()
    rejectedScope.rejectWrites = true
    const rejected = createRoboHostSkillLibrary(rejectedScope.asScope())
    await expect(rejected.add('navigation-diagnostics')).rejects.toThrow('技能未能保存到本机')
    expect(rejected.getSnapshot()).toEqual([])

    const staleScope = new HostSkillScope()
    staleScope.ignoreWrites = true
    const stale = createRoboHostSkillLibrary(staleScope.asScope())
    await expect(stale.add('navigation-diagnostics')).rejects.toThrow('其他窗口更新')
    expect(stale.getSnapshot()).toEqual([])

    const loadingScope = new HostSkillScope('loading')
    const loading = createRoboHostSkillLibrary(loadingScope.asScope())
    await expect(loading.add('navigation-diagnostics')).rejects.toThrow('暂时无法保存')
    rejected.dispose(); stale.dispose(); loading.dispose()
  })

  it('survives library rebinds without depending on browser origin storage', async () => {
    const scope = new HostSkillScope()
    const beforeRestart = createRoboHostSkillLibrary(scope.asScope())
    await beforeRestart.add('arm-inspection')
    beforeRestart.dispose()

    const afterRestart = createRoboHostSkillLibrary(scope.asScope())
    expect(afterRestart.getSnapshot()).toEqual(['arm-inspection'])
    scope.externalUpdate([])
    expect(afterRestart.getSnapshot()).toEqual([])
    afterRestart.dispose()
  })

  it('rejects queued work after disposal and never publishes its settlement', async () => {
    const scope = new HostSkillScope()
    let release!: () => void
    scope.beforeCommit = () => new Promise<void>(resolve => { release = resolve })
    const library = createRoboHostSkillLibrary(scope.asScope())
    const changed = vi.fn()
    library.subscribe(changed)
    const pending = library.add('navigation-diagnostics')
    await Promise.resolve()
    library.dispose()
    release()

    await expect(pending).rejects.toThrow('技能库已关闭')
    expect(library.getSnapshot()).toEqual([])
    expect(changed).not.toHaveBeenCalled()
    await expect(library.add('ros-log-summary')).rejects.toThrow('技能库已关闭')
  })
})

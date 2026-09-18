// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RoboCodingAccountView } from '../src/robocoding-account-contract.ts'
import type { RoboCodingAccountApi } from '../src/client/robocoding-account-api.ts'
import { RoboServiceOnboarding, type RoboOnboardingSettings } from '../src/client/RoboServiceOnboarding.tsx'
import { applyRoboServiceOnboarding } from '../src/client/robo-service-onboarding.ts'
import type { Context } from '@deepseek-ai/cordis'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) => createElement('section', { role: 'dialog', 'aria-label': title }, children),
}))

function setupScope(completed = false) {
  const scope = {
    state: { mode: 'host', status: 'ready', value: { completed } },
    listeners: new Set<() => void>(),
    getSnapshot() { return this.state },
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
    set: vi.fn(async () => { scope.state = { ...scope.state, value: { completed: true } }; scope.listeners.forEach(listener => listener()) }),
  }
  return scope
}

const account: RoboCodingAccountView = { state: 'signed_out', platformUrl: 'http://127.0.0.1:3000',
  teams: [], funding: { mode: 'personal_only', teamId: 0, confirmedTeamId: 0 }, pointsPerCny: 10, billingCurrency: 'CNY' }

async function mount(options: { signedIn?: boolean; completed?: boolean; failedLogin?: boolean; unconfigured?: boolean; pendingRead?: boolean; rejectedReadOnce?: boolean } = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  container.id = 'root'
  document.body.append(container)
  const root = createRoot(container)
  const scope = setupScope(options.completed)
  let resolveRead: ((value: RoboCodingAccountView) => void) | undefined
  const pending = new Promise<RoboCodingAccountView>(resolve => { resolveRead = resolve })
  const accountView = { ...account, state: options.signedIn ? 'signed_in' as const : options.unconfigured ? 'unconfigured' as const : 'signed_out' as const,
    platformUrl: options.unconfigured ? '' : account.platformUrl }
  let reads = 0
  const api = {
    read: vi.fn(async () => { reads += 1; if (options.rejectedReadOnce && reads === 1) throw new Error('offline'); return options.pendingRead ? pending : accountView }),
    login: vi.fn(async () => { if (options.failedLogin) throw new Error('本地服务未启动'); return account }),
  }
  const complete = vi.fn()
  const openSection = vi.fn()
  await act(async () => root.render(createElement(RoboServiceOnboarding, {
    stepId: 'deepseek-official', complete, openSection,
    api: api as unknown as RoboCodingAccountApi, scope: scope as unknown as SettingsScope<RoboOnboardingSettings>,
  })))
  return { container, scope, api, complete, openSection, resolveRead: () => { resolveRead?.(accountView) }, async click(text: string) {
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === text)
    expect(button).toBeDefined()
    await act(async () => button!.click())
  }, async dispose() { await act(async () => root.unmount()); container.remove() } }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('official service onboarding', () => {
  it('opens official authorization without requesting an API key and remembers the choice', async () => {
    const ui = await mount()
    try {
      expect(ui.container.textContent).not.toContain('DeepSeek')
      expect(ui.container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('开始使用 RoboCoding')
      expect(ui.container.textContent).not.toContain('不是学好了再干')
      expect(ui.container.textContent).not.toContain('无需填写 API Key')
      expect(ui.container.querySelector('h3')).toBeNull()
      expect(ui.container.querySelector('input')).toBeNull()
      await ui.click('登录官方账号')
      expect(ui.api.login).toHaveBeenCalledOnce()
      expect(ui.scope.set).toHaveBeenCalledWith('completed', true)
      expect(ui.openSection).toHaveBeenCalledWith('robocoding-account')
      expect(ui.complete).toHaveBeenCalled()
    } finally { await ui.dispose() }
  })
  it('preserves the welcome and reports login failure', async () => {
    const ui = await mount({ failedLogin: true })
    try {
      await ui.click('登录官方账号')
      expect(ui.container.querySelector('[role=alert]')?.textContent).toBe('本地服务未启动')
      expect(ui.complete).not.toHaveBeenCalled()
      expect(ui.scope.set).not.toHaveBeenCalled()
    } finally { await ui.dispose() }
  })
  it('paints and blocks nothing while the account read is pending', async () => {
    const ui = await mount({ pendingRead: true })
    try {
      expect(ui.container.querySelector('[role=dialog]')).toBeNull()
      expect(ui.container.inert).not.toBe(true)
      expect(ui.complete).not.toHaveBeenCalled()
      await act(async () => { ui.resolveRead(); await Promise.resolve() })
      expect(ui.container.querySelector('[role=dialog]')).not.toBeNull()
    } finally { await ui.dispose() }
  })
  it('shows an accessible recovery path after a rejected account read', async () => {
    const ui = await mount({ rejectedReadOnce: true })
    try {
      expect(ui.container.querySelector('[role=dialog]')).not.toBeNull()
      expect(ui.container.querySelector('[role=alert]')?.textContent).toContain('无法连接本地账户服务')
      await ui.click('重试')
      expect(ui.api.read).toHaveBeenCalledTimes(2)
      expect(ui.container.querySelector('[role=alert]')).toBeNull()
      await ui.click('添加自定义模型')
      expect(ui.openSection).toHaveBeenCalledWith('models')
    } finally { await ui.dispose() }
  })
  it('opens account configuration without attempting login when no platform URL exists', async () => {
    const ui = await mount({ unconfigured: true })
    try {
      await ui.click('配置官方服务')
      expect(ui.api.login).not.toHaveBeenCalled()
      expect(ui.openSection).toHaveBeenCalledWith('robocoding-account')
    } finally { await ui.dispose() }
  })
  it('opens custom models without logging into the official service', async () => {
    const ui = await mount()
    try {
      await ui.click('添加自定义模型')
      expect(ui.api.login).not.toHaveBeenCalled()
      expect(ui.openSection).toHaveBeenCalledWith('models')
    } finally { await ui.dispose() }
  })
  it('persists signed-in completion before completing the onboarding step', async () => {
    const ui = await mount({ signedIn: true })
    try {
      expect(ui.scope.set).toHaveBeenCalledWith('completed', true)
      expect(ui.complete).toHaveBeenCalledOnce()
      expect(ui.scope.set.mock.invocationCallOrder[0]).toBeLessThan(ui.complete.mock.invocationCallOrder[0]!)
      expect(ui.container.querySelector('[role=dialog]')).toBeNull()
    } finally { await ui.dispose() }
  })
  it('skips onboarding when completion was already persisted', async () => {
    const ui = await mount({ completed: true })
    try { expect(ui.complete).toHaveBeenCalled(); expect(ui.container.querySelector('[role=dialog]')).toBeNull() }
    finally { await ui.dispose() }
  })
  it('shadows both legacy steps by their existing slot identity', () => {
    const registrations: Array<{ id: string; priority: number }> = []
    const ctx = { settingsScope: { bind: () => setupScope() }, effect: vi.fn(), slots: {
      inject: (_name: string, factory: () => Generator<unknown>) => [...factory()],
      register: (entry: { id: string; priority: number }) => { registrations.push(entry); return () => {} },
    } } as unknown as Context
    applyRoboServiceOnboarding(ctx)
    expect(registrations.map(({ id, priority }) => ({ id, priority }))).toEqual([
      { id: 'welcome-notice', priority: -100 }, { id: 'deepseek-official', priority: -100 },
    ])
  })
})

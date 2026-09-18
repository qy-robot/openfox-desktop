// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoboSidebarAccount } from '../src/client/RoboSidebarAccount.tsx'
import { createRoboCodingAccountApi, ROBO_ACCOUNT_CHANGED, type RoboCodingAccountApi } from '../src/client/robocoding-account-api.ts'
import type { RoboCodingAccountView } from '../src/robocoding-account-contract.ts'

const signedOut: RoboCodingAccountView = { state: 'unconfigured', platformUrl: '', teams: [], funding: { mode: 'personal_only', teamId: 0, confirmedTeamId: 0 }, pointsPerCny: 10, billingCurrency: 'CNY' }
const signedIn: RoboCodingAccountView = { ...signedOut, state: 'signed_in', platformUrl: 'http://127.0.0.1:3000', user: { id: 1, username: 'test', displayName: '测试用户', balancePoints: 128.5 } }

async function mount(initial = signedOut, wide = true) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let current = initial
  const api: RoboCodingAccountApi = {
    read: vi.fn(async () => current), refresh: vi.fn(async () => { current = { ...signedIn, user: { ...signedIn.user!, balancePoints: 100 } }; return current }),
    login: vi.fn(async () => current), logout: vi.fn(async () => { current = signedOut; return current }),
    setPlatformUrl: vi.fn(async () => current), selectFunding: vi.fn(async () => current),
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(createElement(RoboSidebarAccount, { api, wide })))
  return { api, container, async update(value: RoboCodingAccountView) { current = value; await act(async () => { window.dispatchEvent(new Event(ROBO_ACCOUNT_CHANGED)) }) },
    async click(text: string) { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()) },
    async open() { await act(async () => container.querySelector('button')!.click()) },
    async dispose() { await act(async () => root.unmount()); container.remove() } }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('sidebar account card', () => {
  it('opens existing settings and phone panels from the account menu when signed out', async () => {
    const owners = document.createElement('div')
    owners.innerHTML = '<div data-slot="sidebar.settings"><button aria-haspopup="dialog" aria-expanded="false">original settings</button></div><div data-slot="sidebar.footer.action"><span><button aria-label="手机连接" aria-expanded="false">original phone</button></span></div>'
    document.body.append(owners)
    const buttons = [...owners.querySelectorAll('button')]
    const callbacks = buttons.map(button => {
      const callback = vi.fn(() => button.setAttribute('aria-expanded', 'true'))
      button.addEventListener('click', callback)
      return callback
    })
    const ui = await mount()
    try {
      for (const [index, label] of ['设置', '手机连接'].entries()) {
        await ui.open()
        await ui.click(label)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
        expect(callbacks[index]).toHaveBeenCalledOnce()
        expect(document.querySelector('.roboAccountMenu')).toBeNull()
        await act(async () => buttons[index]!.setAttribute('aria-expanded', 'false'))
        expect(document.activeElement).toBe(ui.container.querySelector('button'))
      }
    } finally { await ui.dispose(); owners.remove() }
  })

  it('opens settings with Command-comma and ignores ordinary commas', async () => {
    const owner = document.createElement('div')
    owner.dataset.slot = 'sidebar.settings'
    owner.innerHTML = '<button aria-haspopup="dialog" aria-expanded="false">settings</button>'
    document.body.append(owner)
    const click = vi.fn(() => owner.firstElementChild!.setAttribute('aria-expanded', 'true'))
    owner.firstElementChild!.addEventListener('click', click)
    const ui = await mount()
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',' }))
        await new Promise(resolve => setTimeout(resolve, 10))
      })
      expect(click).not.toHaveBeenCalled()
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, cancelable: true }))
        await new Promise(resolve => setTimeout(resolve, 10))
      })
      expect(click).toHaveBeenCalledOnce()
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
        await new Promise(resolve => setTimeout(resolve, 10))
      })
      expect(click).toHaveBeenCalledOnce()
    } finally { await ui.dispose(); owner.remove() }
  })
  it('automatically rereads status every 30 seconds and on window focus', async () => {
    vi.useFakeTimers()
    const ui = await mount()
    try {
      vi.mocked(ui.api.read).mockClear()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(ui.api.read).toHaveBeenCalledOnce()
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(ui.api.read).toHaveBeenCalledTimes(2)
    } finally { await ui.dispose(); vi.useRealTimers() }
  })
  it('automatically refreshes the signed-in balance from the server', async () => {
    vi.useFakeTimers()
    const ui = await mount(signedIn)
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(ui.api.refresh).toHaveBeenCalledOnce()
      expect(ui.container.textContent).toContain('100 点')
    } finally { await ui.dispose(); vi.useRealTimers() }
  })
  it('keeps unconfigured status honest and opens the existing account panel', async () => {
    const ui = await mount()
    try {
      expect(ui.container.textContent).toContain('服务未连接')
      expect(ui.container.textContent).not.toContain('点')
      await ui.open(); await ui.click('登录账号')
      expect(document.querySelector('.roboAccountDialog')).not.toBeNull()
      expect(ui.api.login).not.toHaveBeenCalled()
      expect(document.querySelector('.roboAccountDialog input[type=url]')).toBeNull()
    } finally { await ui.dispose() }
  })
  it('shows the explicit signed-out status after the service is configured', async () => {
    const ui = await mount({ ...signedOut, state: 'signed_out', platformUrl: 'http://127.0.0.1:3000' })
    try {
      expect(ui.container.textContent).toContain('未登陆')
    } finally { await ui.dispose() }
  })
  it('shows true balance, refreshes, and clears identity after logout', async () => {
    const ui = await mount(signedIn)
    try {
      expect(ui.container.textContent).toContain('128.5 点')
      await ui.open()
      expect(document.querySelector('.roboAccountMenu')?.textContent).not.toContain('刷新')
      await ui.update({ ...signedIn, user: { ...signedIn.user!, balancePoints: 100 } })
      expect(ui.container.textContent).toContain('100 点')
      await ui.click('退出登录')
      expect(ui.api.logout).toHaveBeenCalledOnce()
      expect(ui.container.textContent).not.toContain('测试用户')
      expect(document.querySelector('.roboAccountMenu')?.textContent).not.toContain('100 点')
    } finally { await ui.dispose() }
  })
  it('updates from account changes and labels the collapsed avatar', async () => {
    const ui = await mount(signedOut, false)
    try {
      await ui.update(signedIn)
      expect(ui.container.querySelector('button')?.getAttribute('aria-label')).toBe('测试用户，128.5 点，账户菜单')
      expect(ui.container.querySelector('.roboSidebarAccountCopy')).toBeNull()
      await ui.update(signedOut)
      expect(ui.container.querySelector('button')?.getAttribute('aria-label')).toContain('登录账号')
    } finally { await ui.dispose() }
  })
  it('does not retain a stale balance when the account read fails', async () => {
    const ui = await mount(signedIn)
    try {
      vi.mocked(ui.api.read).mockRejectedValue(new Error('offline'))
      await ui.update(signedIn)
      expect(ui.container.textContent).toContain('连接异常')
      expect(ui.container.textContent).not.toContain('128.5')
    } finally { await ui.dispose() }
  })
  it('dismisses the account menu with Escape and restores the card focus', async () => {
    const ui = await mount(signedIn)
    try {
      const trigger = ui.container.querySelector('button')!
      trigger.focus()
      await ui.open()
      expect(document.querySelector('.roboAccountMenu')).not.toBeNull()
      await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(document.querySelector('.roboAccountMenu')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    } finally { await ui.dispose() }
  })
  it('notifies sidebar consumers only after successful mutations', async () => {
    const listener = vi.fn(); window.addEventListener(ROBO_ACCOUNT_CHANGED, listener)
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: signedOut }))))
      const api = createRoboCodingAccountApi()
      await api.read(); expect(listener).not.toHaveBeenCalled()
      await api.logout(); expect(listener).toHaveBeenCalledOnce()
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'failed' }), { status: 500 }))
      await expect(api.logout()).rejects.toThrow('failed')
      expect(listener).toHaveBeenCalledOnce()
    } finally { window.removeEventListener(ROBO_ACCOUNT_CHANGED, listener) }
  })
})

// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoboCodingAccountApi } from '../src/client/robocoding-account-api.ts'
import { RoboCodingAccountSection } from '../src/client/RoboCodingAccountSection.tsx'
import type { RoboCodingAccountView } from '../src/robocoding-account-contract.ts'

const signedOut: RoboCodingAccountView = {
  state: 'signed_out', platformUrl: 'http://127.0.0.1:3000', teams: [],
  funding: { mode: 'personal_only', teamId: 0, confirmedTeamId: 0 },
  pointsPerCny: 10, billingCurrency: 'CNY',
}

const signedIn: RoboCodingAccountView = {
  ...signedOut,
  state: 'signed_in',
  user: { id: 8, username: 'lin@example.com', displayName: '林工', balancePoints: 128.5 },
  teams: [{ id: 42, name: '导航算法组', role: '成员', department: '研发中心', balancePoints: 8_240,
    monthlyLimitPoints: 2_000, monthlyUsedPoints: 740, month: '2026-09' }],
}

let root: Root | undefined
let container: HTMLDivElement | undefined

function accountApi(initial: RoboCodingAccountView) {
  const api: RoboCodingAccountApi = {
    read: vi.fn(async () => initial), refresh: vi.fn(async () => initial), login: vi.fn(async () => initial),
    logout: vi.fn(async () => signedOut), setPlatformUrl: vi.fn(async () => initial),
    selectFunding: vi.fn(async () => initial),
  }
  return api
}

async function mount(initial: RoboCodingAccountView) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const api = accountApi(initial)
  await act(async () => { root!.render(createElement(RoboCodingAccountSection, { api })); await Promise.resolve() })
  return { api, container }
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
  if (found === undefined) throw new Error(`missing button: ${text}`)
  return found
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  vi.unstubAllGlobals()
})

describe('OpenFox account settings', () => {
  it('uses the default service without exposing connection settings', async () => {
    const { api, container } = await mount(signedOut)
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('input[type=url]')).toBeNull()
    expect(container.textContent).not.toContain('连接设置')
    expect(container.textContent).toContain('登录官方账号')
    expect(container.textContent).not.toContain('1 元人民币 = 10 点')
    await act(async () => button('登录官方账号').click())
    expect(api.login).toHaveBeenCalledOnce()
  })

  it('explains why official sign-in is unavailable before a service is connected', async () => {
    const { container } = await mount({ ...signedOut, state: 'unconfigured', platformUrl: '' })
    expect(button('登录官方账号').disabled).toBe(true)
    expect(container.textContent).toContain('服务未连接')
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('input[type=url]')).toBeNull()
    expect(container.textContent).not.toContain('连接设置')
  })

  it('renders the real account identity and balances without prompting on open', async () => {
    const confirm = vi.fn()
    vi.stubGlobal('confirm', confirm)
    const { container } = await mount(signedIn)
    expect(container.textContent).toContain('林工')
    expect(container.textContent).toContain('lin@example.com')
    expect(container.textContent).toContain('128.5 点')
    expect(container.textContent).toContain('个人点数')
    expect(container.textContent).toContain('8,240 点')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('requires concise inline consent before first use of team points', async () => {
    const { api, container } = await mount(signedIn)
    const teamChoice = container.querySelector<HTMLInputElement>('input[value="team-42"]')
    expect(teamChoice).not.toBeNull()
    await act(async () => teamChoice!.click())
    expect(api.selectFunding).not.toHaveBeenCalled()
    const dialog = container.querySelector('[role="alertdialog"]')
    expect(dialog?.textContent).toContain('仅影响后续新任务')
    expect(dialog?.textContent).toContain('不会改用个人点数')
    await act(async () => button('确认使用').click())
    expect(api.selectFunding).toHaveBeenCalledWith('team_only', 42, true)
  })

  it('cancels team consent without changing the payment source', async () => {
    const { api, container } = await mount(signedIn)
    await act(async () => container.querySelector<HTMLInputElement>('input[value="team-42"]')!.click())
    await act(async () => button('取消').click())
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(api.selectFunding).not.toHaveBeenCalled()
  })

  it('reuses prior team consent without asking again', async () => {
    const confirmed = { ...signedIn, funding: { mode: 'personal_only' as const, teamId: 0, confirmedTeamId: 42 } }
    const { api, container } = await mount(confirmed)
    await act(async () => { container.querySelector<HTMLInputElement>('input[value="team-42"]')!.click(); await Promise.resolve() })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(api.selectFunding).toHaveBeenCalledWith('team_only', 42, true)
  })
})

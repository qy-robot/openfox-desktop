// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { roboLocalSkillsApi, type RoboLocalSkillsApi } from '../src/client/robo-local-skills-api.ts'
import { RoboSkillMarket } from '../src/client/RoboSkillMarket.tsx'
import { parseRoboCatalog, type RoboCatalog, type RoboSkillsApi } from '../src/client/robo-skills-api.ts'
import { createRoboSkillLibrary } from '../src/client/robo-skills-library.ts'

const catalog: RoboCatalog = parseRoboCatalog({
  schemaVersion: 1,
  mode: 'local-demo',
  marketRevision: 7,
  featuredSkillIds: ['ros-log-summary', 'navigation-diagnostics'],
  categories: [{ id: 'inspection', name: '巡检诊断', visible: true }, { id: 'engineering', name: '工程工具', visible: true }],
  robots: [
    { id: 'qy-x1', displayName: '擎云 X1', manufacturer: '擎云机器人', family: '轮式机器人', profiles: [{ id: 'standard', label: '标准版' }] },
    { id: 'qy-a2', displayName: '擎云 A2', manufacturer: '擎云机器人', family: '机械臂', profiles: [{ id: 'factory', label: '工厂版' }] },
  ],
  skills: [
    { id: 'navigation-diagnostics', displayName: '导航日志诊断', description: '分析定位和导航日志', version: '0.1.0', category: 'inspection', robotIndependent: false, targets: [{ modelId: 'qy-x1', profileIds: ['standard'] }], demo: true, publisher: { kind: 'company', displayName: 'Release Operations', labels: ['管理员'] }, details: { overview: '定位导航异常并给出排查方向。', inputs: ['导航日志文件'], outputs: ['异常摘要'], limitations: ['仅分析已提供的日志内容。'] } },
    { id: 'arm-inspection', displayName: '机械臂巡检', description: '检查机械臂状态', version: '0.1.0', category: 'inspection', robotIndependent: false, targets: [{ modelId: 'qy-a2', profileIds: ['factory'] }], demo: true },
    { id: 'ros-log-summary', displayName: 'ROS 日志摘要', description: '整理通用 ROS 日志', version: '0.2.0', category: 'engineering', robotIndependent: true, targets: [], demo: true },
  ],
})

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  value: string | null = null
  getItem = vi.fn(() => this.value)
  setItem = vi.fn((_key: string, value: string) => { this.value = value })
}

function click(element: Element | undefined | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('expected clickable element')
  act(() => { element.click() })
}

function changeValue(element: Element | null, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error('expected form control')
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('form control setter unavailable')
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
  })
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  vi.spyOn(roboLocalSkillsApi, 'list').mockResolvedValue([])
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Robo skill market', () => {
  it('opens a catalog without configured featured skills on All and keeps an explicit empty Featured view', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const withoutFeatured = parseRoboCatalog({ ...catalog, featuredSkillIds: [] })
    const library = createRoboSkillLibrary(new MemoryStorage())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillMarket, {
        api: { catalog: vi.fn().mockResolvedValue(withoutFeatured), run: vi.fn() } as unknown as RoboSkillsApi,
        library,
        close: vi.fn(),
      })) })
      await settle()
      expect([...container.querySelectorAll('button')].find(button => button.textContent === '全部')?.getAttribute('aria-pressed')).toBe('true')
      expect(container.textContent).toContain('3 个技能')
      click([...container.querySelectorAll('button')].find(button => button.textContent === '精选'))
      expect(container.textContent).toContain('暂无精选技能')
    } finally {
      await act(async () => { root.unmount() })
      library.dispose(); container.remove()
    }
  })

  it('filters the catalog, opens details, and persists add/remove choices', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new MemoryStorage()
    const library = createRoboSkillLibrary(storage)
    const api = { catalog: vi.fn().mockResolvedValue(catalog), run: vi.fn() } as unknown as RoboSkillsApi
    const close = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillMarket, { api, library, close })) })
      await settle()
      expect(container.textContent).toContain('技能')
      expect(container.textContent).not.toContain('返回会话')
      expect(container.querySelector('h1')).toBeNull()
      expect(container.querySelector('button[aria-label="添加本地技能"]')).not.toBeNull()
      expect(container.querySelector('.roboMarketTop a')).toBeNull()
      expect(container.textContent).toContain('2 个技能')
      expect(container.textContent).not.toContain('机械臂巡检')
      expect([...container.querySelectorAll('.roboMarketCard h3')].map(item => item.textContent)).toEqual(['ROS 日志摘要', '导航日志诊断'])
      click([...container.querySelectorAll('button')].find(button => button.textContent === '全部'))
      expect(container.textContent).toContain('3 个技能')

      click([...container.querySelectorAll('button')].find(button => button.textContent === '巡检诊断'))
      expect(container.textContent).toContain('导航日志诊断')
      expect(container.textContent).not.toContain('ROS 日志摘要')
      changeValue(container.querySelector('[aria-label="市场设备筛选"]'), 'qy-x1')
      expect(container.textContent).toContain('导航日志诊断')
      expect(container.textContent).not.toContain('机械臂巡检')
      changeValue(container.querySelector('[aria-label="搜索技能市场"]'), '导航')
      expect(container.textContent).toContain('1 个技能')

      click(container.querySelector('[data-skill-card="navigation-diagnostics"]'))
      expect(container.querySelector('[role="dialog"]')).not.toBeNull()
      expect(container.querySelector('.roboMarketModal > .roboMarketModalBody')).not.toBeNull()
      expect(container.querySelector('.roboMarketModal > .roboMarketModalFooter')).not.toBeNull()
      expect(container.textContent).toContain('详情简介')
      expect(container.textContent).toContain('需要提供')
      expect(container.textContent).toContain('输出内容')
      expect(container.textContent).toContain('能力与限制')
      expect(container.textContent).toContain('适用范围')
      expect(container.textContent).not.toContain('内部执行步骤')
      expect(container.querySelector('.roboMarketPublisher')?.textContent).toContain('擎云官方')
      expect(container.querySelector('.roboMarketPublisher')?.textContent).toContain('Release Operations')
      expect(container.querySelector('.roboMarketPublisher')?.textContent).toContain('管理员')
      expect(container.textContent).not.toContain('后台发布目录')
      click(container.querySelector('[aria-label="添加导航日志诊断"]'))
      await settle()
      expect(library.getSnapshot()).toEqual(['navigation-diagnostics'])
      expect(storage.setItem).toHaveBeenCalledWith('robo-skills-library-v1', '["navigation-diagnostics"]')
      const reloaded = createRoboSkillLibrary(storage)
      expect(reloaded.getSnapshot()).toEqual(['navigation-diagnostics'])
      reloaded.dispose()

      click(container.querySelector('[aria-label="移除导航日志诊断"]'))
      await settle()
      expect(library.getSnapshot()).toEqual([])
      expect(storage.value).toBe('[]')
      click(container.querySelector('[aria-label="关闭技能详情"]'))
      click([...container.querySelectorAll('button')].find(button => button.textContent === '全部'))
      changeValue(container.querySelector('[aria-label="搜索技能市场"]'), '')
      changeValue(container.querySelector('[aria-label="市场设备筛选"]'), '')
      click(container.querySelector('[data-skill-card="arm-inspection"]'))
      expect(container.textContent).not.toContain('详情简介')
      expect(container.textContent).not.toContain('需要提供')
      expect(container.textContent).not.toContain('输出内容')
      expect(container.textContent).not.toContain('能力与限制')
      expect(container.textContent).not.toContain('使用方式')
      expect(container.textContent).not.toContain('发布者')
      click(container.querySelector('[aria-label="关闭技能详情"]'))
      click([...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('管理')))
      expect(container.textContent).toContain('还没有添加市场技能')
      expect(close).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() })
      library.dispose(); container.remove()
    }
  })

  it('refreshes visible markets, reconciles removed filters, and keeps stale data on background errors', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const updated = parseRoboCatalog({
      schemaVersion: 1,
      mode: 'local-demo',
      marketRevision: 8,
      featuredSkillIds: ['ros-log-summary'],
      categories: [{ id: 'engineering', name: '工程工具', visible: true }],
      robots: [],
      skills: [{ id: 'ros-log-summary', displayName: 'ROS 日志摘要（新版）', description: '整理通用 ROS 日志', version: '0.3.0', category: 'engineering', robotIndependent: true, targets: [], demo: true }],
    })
    const api = { catalog: vi.fn()
      .mockResolvedValueOnce(catalog)
      .mockResolvedValueOnce(updated)
      .mockRejectedValueOnce(new Error('后台刷新失败')), run: vi.fn() } as unknown as RoboSkillsApi
    const library = createRoboSkillLibrary(new MemoryStorage())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillMarket, { api, library, close: vi.fn() })) })
      await settle()
      click([...container.querySelectorAll('button')].find(button => button.textContent === '巡检诊断'))
      changeValue(container.querySelector('[aria-label="市场设备筛选"]'), 'qy-x1')
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await settle()
      expect(container.textContent).toContain('ROS 日志摘要（新版）')
      expect((container.querySelector('[aria-label="市场设备筛选"]') as HTMLSelectElement).value).toBe('')
      expect([...container.querySelectorAll('button')].find(button => button.textContent === '全部')?.getAttribute('aria-pressed')).toBe('true')

      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await settle()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('后台刷新失败')
      expect(container.textContent).toContain('ROS 日志摘要（新版）')
      expect(container.textContent).not.toContain('正在加载技能市场')
    } finally {
      await act(async () => { root.unmount() })
      library.dispose(); container.remove()
    }
  })

  it('reports catalog and persistence errors without claiming the skill was added', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new MemoryStorage()
    storage.setItem.mockImplementation(() => { throw new Error('quota') })
    const library = createRoboSkillLibrary(storage)
    const api = { catalog: vi.fn().mockResolvedValue(catalog), run: vi.fn() } as unknown as RoboSkillsApi
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillMarket, { api, library, close: vi.fn() })) })
      await settle()
      click(container.querySelector('[aria-label="添加ROS 日志摘要"]'))
      await settle()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('技能未能保存到本机')
      expect(library.getSnapshot()).toEqual([])
      expect(container.querySelector('[aria-label="添加ROS 日志摘要"]')).not.toBeNull()
    } finally {
      await act(async () => { root.unmount() })
      library.dispose(); container.remove()
    }

    const failedApi = { catalog: vi.fn().mockRejectedValue(new Error('目录离线')), run: vi.fn() } as unknown as RoboSkillsApi
    const retryLibrary = createRoboSkillLibrary(new MemoryStorage())
    const failedContainer = document.createElement('div')
    document.body.append(failedContainer)
    const failedRoot = createRoot(failedContainer)
    try {
      await act(async () => { failedRoot.render(createElement(RoboSkillMarket, { api: failedApi, library: retryLibrary, close: vi.fn() })) })
      await settle()
      expect(failedContainer.querySelector('[role="alert"]')?.textContent).toContain('目录离线')
      expect(failedContainer.textContent).toContain('0 个技能')
      expect(failedContainer.textContent).not.toContain('本地示例')
      click([...failedContainer.querySelectorAll('button')].find(button => button.textContent === '重试'))
      await settle()
      expect(failedApi.catalog).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => { failedRoot.unmount() })
      retryLibrary.dispose(); failedContainer.remove()
    }
  })
})


describe('local skill import from the market', () => {
  it('uses the local folder picker, keeps import errors retryable, and manages a persistent skill', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const skill = { name: 'local-helper', description: '本地助手', path: '/local/skills/local-helper/SKILL.md' }
    let imported = false
    const localApi: RoboLocalSkillsApi = {
      list: vi.fn(async () => imported ? [skill] : []),
      pick: vi.fn().mockResolvedValueOnce(null).mockResolvedValue('/source/local-helper'),
      import: vi.fn().mockRejectedValueOnce(new Error('缺少 SKILL.md')).mockImplementation(async () => { imported = true; return skill }),
      remove: vi.fn(async () => { imported = false }),
    }
    const library = createRoboSkillLibrary(new MemoryStorage())
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillMarket, {
        api: { catalog: vi.fn().mockRejectedValue(new Error('市场离线')), run: vi.fn() } as unknown as RoboSkillsApi,
        library, localApi, close: vi.fn(),
      })) }); await settle()
      click(container.querySelector('[aria-label="添加本地技能"]')); await settle()
      expect(container.querySelector('dialog[open]')).not.toBeNull()
      expect(container.textContent).toContain('审核通过后上架')
      expect(container.querySelector('dialog a')?.getAttribute('href')).toBe('https://dash.openfox.work/workbench/skills')
      const folder = () => [...container.querySelectorAll('button')].find(button => button.textContent === '选择文件夹')
      click(folder()); await settle()
      expect((container.querySelector('[aria-label="技能文件夹路径"]') as HTMLInputElement).value).toBe('')
      expect(localApi.import).not.toHaveBeenCalled()
      click(folder()); await settle()
      expect((container.querySelector('[aria-label="技能文件夹路径"]') as HTMLInputElement).value).toBe('/source/local-helper')
      click(container.querySelector('button[type="submit"]')); await settle()
      expect(container.querySelector('dialog [role="alert"]')?.textContent).toBe('缺少 SKILL.md')
      expect(container.querySelector('dialog[open]')).not.toBeNull()
      click(container.querySelector('button[type="submit"]')); await settle()
      expect(localApi.import).toHaveBeenLastCalledWith('/source/local-helper')
      expect(container.querySelector('dialog')).toBeNull()
      expect(container.querySelector('[aria-label="本地技能"]')?.textContent).toContain('local-helper')
      expect(container.textContent).toContain('/local-helper')
      click(container.querySelector('.roboLocalSkillRow button')); await settle()
      expect(localApi.remove).not.toHaveBeenCalled()
      click([...container.querySelectorAll('.roboLocalSkillRow button')].find(button => button.textContent === '确认移除')); await settle()
      expect(localApi.remove).toHaveBeenCalledWith('local-helper')
      expect(container.querySelector('.roboLocalSkillRow')).toBeNull()
      expect(container.textContent).toContain('原始文件夹保留')
    } finally { await act(async () => { root.unmount() }); library.dispose(); container.remove() }
  })
})

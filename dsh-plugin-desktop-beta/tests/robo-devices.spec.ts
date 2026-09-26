// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { RoboDeviceWorkbench } from '../src/client/RoboDeviceWorkbench.tsx'
import {
  createRoboDeviceSelection,
  parseRoboSshConnection,
  roboSshConnectionFromConfiguration,
} from '../src/client/robo-device-selection.ts'
import { parseRoboCatalog, selectionFor, type RoboSkillsApi } from '../src/client/robo-skills-api.ts'

const catalog = parseRoboCatalog({
  schemaVersion: 1,
  mode: 'local-demo',
  categories: [{ id: 'inspection', name: '巡检' }],
  robots: [
    { id: 'qy-x1', displayName: '擎云 X1', manufacturer: '擎云机器人', family: '轮式机器人', profiles: [{ id: 'standard', label: '标准版' }, { id: 'lidar', label: '激光雷达版' }] },
    { id: 'qy-a2', displayName: '擎云 A2', manufacturer: '擎云机器人', family: '机械臂', profiles: [{ id: 'factory', label: '工厂版' }] },
  ],
  skills: [{ id: 'navigation', displayName: '导航', description: '导航检查', version: '1.0.0', category: 'inspection', robotIndependent: false, targets: [{ modelId: 'qy-x1', profileIds: ['standard', 'lidar'] }], demo: true }],
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
  act(() => { setter.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true })) })
}

async function settle(): Promise<void> { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe('Robo device selection', () => {
  it('persists a model and profile and clears a selection removed from the catalog', () => {
    const storage = new MemoryStorage()
    const selection = createRoboDeviceSelection(storage)
    selection.select('qy-x1', 'lidar')
    expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'lidar' })
    expect(storage.setItem).toHaveBeenCalledWith('robocoding-current-device-v1', '{"modelId":"qy-x1","profileId":"lidar"}')
    const reloaded = createRoboDeviceSelection(storage)
    expect(reloaded.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'lidar' })
    expect(reloaded.reconcile(parseRoboCatalog({ ...catalog, robots: [catalog.robots[1]], skills: [] }))).toBe(true)
    expect(reloaded.getSnapshot()).toEqual({ modelId: '', profileId: '' })
    selection.dispose(); reloaded.dispose()
  })

  it('persists the SSH target supplied by robot selection and rejects unsafe targets', () => {
    const storage = new MemoryStorage()
    const selection = createRoboDeviceSelection(storage)
    const ssh = { host: 'robot.local', user: 'operator', port: 2222, identityFile: 'C:\\keys\\robot' }
    selection.select('qy-x1', 'standard', '擎云 X1', ssh)
    expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'standard', ssh })
    const reloaded = createRoboDeviceSelection(storage)
    expect(reloaded.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'standard', ssh })
    const listener = vi.fn()
    selection.subscribe(listener)
    selection.select('qy-x1', 'standard', '擎云 X1', { ...ssh, host: 'robot-new.local' })
    expect(selection.getSnapshot().ssh?.host).toBe('robot-new.local')
    expect(listener).toHaveBeenCalledOnce()
    expect(roboSshConnectionFromConfiguration(
      { terminal: { kind: 'ssh', host: 'profile.local', user: 'profile' } },
      { ssh: { host: 'model.local', user: 'model' } },
    )).toEqual({ host: 'profile.local', user: 'profile' })
    expect(parseRoboSshConnection({ host: '-oProxyCommand=bad' })).toBeUndefined()
    expect(parseRoboSshConnection({ host: 'robot.local', port: 70_000 })).toBeUndefined()
    expect(() => selection.select('qy-x1', 'standard', '擎云 X1', { host: '-bad' })).toThrow('机器人 SSH 连接信息无效')

    const legacyStorage = new MemoryStorage()
    legacyStorage.value = '{"modelId":"qy-x1","profileId":"standard","modelLabel":"擎云 X1"}'
    const legacy = createRoboDeviceSelection(legacyStorage)
    const catalogWithSsh = parseRoboCatalog({ ...catalog, robots: catalog.robots.map((robot, index) => index ? robot : {
      ...robot, profiles: robot.profiles.map((profile, profileIndex) => profileIndex ? profile : {
        ...profile, configuration: { ssh: { host: 'catalog.local', user: 'catalog' } },
      }),
    }) })
    expect(legacy.reconcile(catalogWithSsh)).toBe(false)
    expect(legacy.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'standard',
      ssh: { host: 'catalog.local', user: 'catalog' } })
    expect(legacyStorage.value).toContain('catalog.local')
    selection.dispose(); reloaded.dispose(); legacy.dispose()
  })

  it('keeps the previous selection when local persistence fails', () => {
    const storage = new MemoryStorage()
    const selection = createRoboDeviceSelection(storage)
    selection.select('qy-x1', 'standard')
    storage.setItem.mockImplementation(() => { throw new Error('quota') })
    expect(() => selection.select('qy-a2', 'factory')).toThrow('设备型号未能保存到本机')
    expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'standard' })
    selection.dispose()
  })

  it('supports search, development-method selection, current-model choice, navigation, and retry', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const storage = new MemoryStorage()
    const selection = createRoboDeviceSelection(storage)
    const api = { catalog: vi.fn(), devices: vi.fn().mockResolvedValue(catalog), run: vi.fn() } as unknown as RoboSkillsApi
    const close = vi.fn(); const openMarket = vi.fn()
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboDeviceWorkbench, { api, selection, close, openMarket })) }); await settle()
      expect(container.querySelectorAll('h1')).toHaveLength(0)
      expect(container.textContent).not.toContain('型号 · 环境 · 技能')
      expect(container.textContent).not.toContain('不会连接、控制或移动实体机器人')
      expect(container.textContent).not.toContain('返回会话')
      expect(container.textContent).toContain('1 个设备型号')
      click(container.querySelector('#device-tab-arm'))
      expect(container.textContent).toContain('1 个机械臂型号')
      changeValue(container.querySelector('[aria-label="搜索机械臂型号"]'), '机械臂')
      expect(container.textContent).toContain('擎云 A2'); expect(container.textContent).not.toContain('擎云 X1')
      click(container.querySelector('#device-tab-robot'))
      expect(container.querySelector('#device-tab-robot')?.getAttribute('aria-selected')).toBe('true')
      click(container.querySelector('[aria-label="查看擎云 X1详情"]'))
      click(container.querySelector('[aria-label="关闭设备详情"]'))
      expect(container.querySelector('.roboDeviceDetails')).toBeNull()
      click(container.querySelector('[aria-label="查看擎云 X1详情"]'))
      changeValue(container.querySelector('[aria-label="擎云 X1版本"]'), 'lidar')
      click([...container.querySelectorAll('button')].find(button => button.textContent === '使用此型号'))
      expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'lidar' })
      expect(container.textContent).toContain('当前型号 · 激光雷达版')
      click([...container.querySelectorAll('button')].find(button => button.textContent === '适用技能'))
      expect(openMarket).toHaveBeenCalledOnce()
      click(container.querySelector('#device-tab-arm'))
      expect(container.querySelector('.roboDeviceDetails')).toBeNull()
      expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'lidar' })
      expect(close).not.toHaveBeenCalled()
    } finally { await act(async () => { root.unmount() }); selection.dispose(); container.remove(); vi.unstubAllGlobals() }

    const failedApi = { catalog: vi.fn(), devices: vi.fn().mockRejectedValue(new Error('设备目录离线')), run: vi.fn() } as unknown as RoboSkillsApi
    const retrySelection = createRoboDeviceSelection(new MemoryStorage())
    const failedContainer = document.createElement('div'); document.body.append(failedContainer)
    const failedRoot = createRoot(failedContainer)
    try {
      await act(async () => { failedRoot.render(createElement(RoboDeviceWorkbench, { api: failedApi, selection: retrySelection, close: vi.fn(), openMarket: vi.fn() })) }); await settle()
      expect(failedContainer.querySelector('[role="alert"]')?.textContent).toContain('设备目录离线')
      click([...failedContainer.querySelectorAll('button')].find(button => button.textContent === '重试')); await settle()
      expect(failedApi.devices).toHaveBeenCalledTimes(2)
      expect(failedApi.catalog).not.toHaveBeenCalled()
    } finally { await act(async () => { failedRoot.unmount() }); retrySelection.dispose(); failedContainer.remove() }
  })

  it('combines family tabs with search and resets family on primary-tab changes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const mixed = parseRoboCatalog({ ...catalog, robots: [...catalog.robots, { ...catalog.robots[0], id: 'qy-h1', displayName: '人形 H1', family: '人形机器人' }] })
    const selection = createRoboDeviceSelection(new MemoryStorage())
    const api = { devices: vi.fn().mockResolvedValue(mixed) } as unknown as RoboSkillsApi
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboDeviceWorkbench, { api, selection, close: vi.fn(), openMarket: vi.fn() })) }); await settle()
      expect(container.querySelector('.roboDeviceHeader input')).not.toBeNull()
      const families = () => [...container.querySelectorAll('.roboDeviceFamilies button')]
      click(families().find(button => button.textContent === '人形机器人'))
      expect(container.querySelectorAll('.roboDeviceCard')).toHaveLength(1)
      expect(container.querySelector('.roboDeviceCards')?.textContent).toContain('人形 H1')
      changeValue(container.querySelector('input'), 'X1')
      expect(container.querySelectorAll('.roboDeviceCard')).toHaveLength(0)
      click(families().find(button => button.textContent === '全部'))
      expect(container.querySelector('.roboDeviceCards')?.textContent).toContain('擎云 X1')
      click(container.querySelector('#device-tab-arm'))
      expect(container.querySelector('input')?.value).toBe('')
      expect(families().map(button => button.textContent)).toEqual(['全部', '机械臂'])
      expect(families()[0]?.getAttribute('aria-selected')).toBe('true')
    } finally { await act(async () => { root.unmount() }); selection.dispose(); container.remove(); vi.unstubAllGlobals() }
  })

  it('accepts published catalog entries but never creates an executable demo selection', () => {
    const published = parseRoboCatalog({
      ...catalog,
      mode: 'catalog',
      skills: catalog.skills.map(skill => ({ ...skill, demo: false, execution: 'server' })),
    })
    expect(published.mode).toBe('catalog')
    expect(published.skills[0]?.demo).toBe(false)
    expect(selectionFor(published.skills[0]!, 'qy-x1', 'standard')).toBeUndefined()
    expect(() => parseRoboCatalog({ ...published, skills: published.skills.map(skill => ({ ...skill, demo: true })) })).toThrow('无效技能适配信息')
  })
  it('keeps the detail modal focused on model identity and version selection', async () => {
    const enhanced = parseRoboCatalog({ ...catalog, robots: catalog.robots.map((robot, index) => index ? robot : {
      ...robot, description: '型号默认说明', configuration: { network: '型号默认网络' }, tutorialUrl: 'https://example.feishu.cn/wiki/model-tutorial',
      profiles: [
        { ...robot.profiles[0], description: '标准开发方式说明', configuration: {
          sdk: 'Standard SDK', ssh: { host: 'robot.local', user: 'operator', port: 2222 },
        }, tutorialUrl: 'https://example.feishu.cn/wiki/standard-tutorial' },
        { ...robot.profiles[1], description: '激光开发方式说明', configuration: {} },
      ],
    }), skills: catalog.skills.map(skill => ({ ...skill, publisher: { kind: 'company', displayName: '小高', labels: ['擎云·小高'], secret: 'hidden' } })) })
    expect(enhanced.skills[0]?.publisher).toEqual({ kind: 'company', displayName: '小高', labels: ['擎云·小高'] })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const selection = createRoboDeviceSelection(new MemoryStorage())
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    const api = { catalog: vi.fn(), devices: vi.fn().mockResolvedValue(enhanced), run: vi.fn() } as unknown as RoboSkillsApi
    try {
      await act(async () => { root.render(createElement(RoboDeviceWorkbench, { api, selection, close: vi.fn(), openMarket: vi.fn() })) }); await settle()
      expect(container.querySelector('iframe')).toBeNull()
      click([...container.querySelectorAll('button')].find(button => button.textContent === '使用此型号'))
      expect(selection.getSnapshot()).toEqual({ modelId: 'qy-x1', profileId: 'standard',
        ssh: { host: 'robot.local', user: 'operator', port: 2222 } })
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain('厂商擎云机器人型号擎云 X1')
      expect(container.querySelector('[aria-label="擎云 X1版本"]')).not.toBeNull()
      changeValue(container.querySelector('[aria-label="擎云 X1版本"]'), 'lidar')
      expect((container.querySelector('[aria-label="擎云 X1版本"]') as HTMLSelectElement | null)?.value).toBe('lidar')
    } finally { await act(async () => { root.unmount() }); selection.dispose(); container.remove(); vi.unstubAllGlobals() }
  })

  it.each(['javascript:alert(1)', 'http://docs.feishu.cn/wiki/a', 'https://feishu.cn.evil.example/a', 'https://user@docs.feishu.cn/wiki/a', 'https://docs.feishu.cn:8443/wiki/a'])(
    'rejects unsafe tutorial URL %s before rendering', tutorialUrl => {
      expect(() => parseRoboCatalog({ ...catalog, robots: catalog.robots.map(robot => ({ ...robot, tutorialUrl })) })).toThrow('无效飞书教程链接')
      expect(() => parseRoboCatalog({ ...catalog, robots: catalog.robots.map(robot => ({
        ...robot, profiles: robot.profiles.map(profile => ({ ...profile, tutorialUrl })),
      })) })).toThrow('无效飞书教程链接')
    })

})

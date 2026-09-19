// @vitest-environment jsdom
import { act, createElement, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type {
  CommandClaim,
  InputState,
  SessionInput,
  TokenSpan,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRoboSkillsApi,
  filterRoboSkills,
  parseRoboCatalog,
  parseRoboResult,
  selectionFor,
  type RoboCatalog,
  type RoboResult,
  type RoboSelection,
  type RoboSkill,
  type RoboSkillsApi,
} from '../src/client/robo-skills-api.ts'
import { createRoboSkillSession, ROBO_SKILL_TOKEN } from '../src/client/robo-skills-state.ts'
import { roboLocalSkillsApi } from '../src/client/robo-local-skills-api.ts'
import { RoboSkillPicker } from '../src/client/RoboSkillPicker.tsx'
import { createRoboSkillLibrary, type RoboSkillLibrary } from '../src/client/robo-skills-library.ts'
import { createRoboDeviceSelection } from '../src/client/robo-device-selection.ts'

beforeEach(() => { vi.spyOn(roboLocalSkillsApi, 'list').mockResolvedValue([]) })
afterEach(() => { vi.restoreAllMocks() })

vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore<T>(initial: T) {
    let snapshot = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set(next: T) {
        snapshot = next
        for (const listener of [...listeners]) listener()
      },
      update(mutator: (draft: T) => void) {
        mutator(snapshot)
        for (const listener of [...listeners]) listener()
      },
    }
  },
}))

const catalogPayload = {
  schemaVersion: 1,
  mode: 'local-demo',
  marketRevision: 12,
  featuredSkillIds: ['ros-log-summary', 'navigation-diagnostics'],
  categories: [
    { id: 'inspection', name: '巡检诊断', visible: true },
    { id: 'engineering', name: '工程工具', visible: false },
  ],
  robots: [
    {
      id: 'qy-x1',
      displayName: '擎云 X1',
      manufacturer: '擎云机器人',
      family: '轮式机器人',
      profiles: [
        { id: 'standard', label: '标准版' },
        { id: 'lidar', label: '激光雷达版' },
      ],
    },
    {
      id: 'qy-a2',
      displayName: '擎云 A2',
      manufacturer: '擎云机器人',
      family: '机械臂',
      profiles: [{ id: 'factory', label: '工厂版' }],
    },
  ],
  skills: [
    {
      id: 'navigation-diagnostics',
      displayName: '导航日志诊断',
      description: '分析定位和导航日志',
      version: '0.1.0',
      category: 'inspection',
      robotIndependent: false,
      targets: [{ modelId: 'qy-x1', profileIds: ['standard', 'lidar'] }],
      demo: true,
    },
    {
      id: 'arm-inspection',
      displayName: '机械臂巡检',
      description: '检查机械臂状态',
      version: '0.1.0',
      category: 'inspection',
      robotIndependent: false,
      targets: [{ modelId: 'qy-a2', profileIds: ['factory'] }],
      demo: true,
    },
    {
      id: 'ros-log-summary',
      displayName: 'ROS 日志摘要',
      description: '整理通用 ROS 日志',
      version: '0.2.0',
      category: 'engineering',
      robotIndependent: true,
      targets: [],
      demo: true,
    },
  ],
} as const

const catalog = parseRoboCatalog(catalogPayload)
const navigationSkill = catalog.skills[0] as RoboSkill
const navigationSelection = selectionFor(navigationSkill, 'qy-x1', 'standard') as RoboSelection

function skillLibrary(...ids: string[]): RoboSkillLibrary {
  let value: string | null = null
  const library = createRoboSkillLibrary({
    getItem: () => value,
    setItem: (_key, next) => { value = next },
  })
  for (const id of ids) library.add(id)
  return library
}

function resultFor(selection: RoboSelection, summary = '分析完成'): RoboResult {
  return {
    mode: 'local-demo',
    demo: true,
    skillId: selection.skillId,
    skillVersion: selection.skillVersion,
    summary,
    findings: [{ level: 'info', message: '未发现阻塞问题' }],
  }
}

interface SessionHarness {
  readonly input: SessionInput
  readonly context: Context
  readonly state: ReturnType<typeof createSnapshotStore<InputState>>
  readonly beginCommand: ReturnType<typeof vi.fn<(claim: CommandClaim, span: TokenSpan) => boolean>>
  readonly submitDefault: ReturnType<typeof vi.fn<() => void>>
  readonly claims: CommandClaim[]
}

function sessionHarness(draft = '保留这段草稿'): SessionHarness {
  const state = createSnapshotStore<InputState>({
    draft,
    attachmentIds: [],
    draftRev: 7,
    phase: 'plain',
    occurrences: [],
    queue: [],
  })
  const claims: CommandClaim[] = []
  const beginCommand = vi.fn((claim: CommandClaim, span: TokenSpan) => {
    const current = state.getSnapshot()
    if (current.phase !== 'plain' || span.draftRev !== current.draftRev) return false
    claims.push(claim)
    state.set({
      ...current,
      draft: `${claim.token}${current.draft.slice(span.end)}`,
      draftRev: current.draftRev + 1,
      phase: 'claimed',
      claim: {
        token: claim.token,
        ...(claim.hint === undefined ? {} : { hint: claim.hint }),
        ...(claim.attachments === undefined ? {} : { attachments: claim.attachments }),
      },
    })
    return true
  })
  const submitDefault = vi.fn()
  const input = {
    state,
    beginCommand,
    submit: submitDefault,
    setDraft: vi.fn(),
    addAttachments: vi.fn(() => false),
    removeAttachment: vi.fn(() => false),
    pruneAttachments: vi.fn(),
    notify: vi.fn(),
    insertReference: vi.fn(() => false),
  } as unknown as SessionInput
  const context = {
    bail: vi.fn((_actx: Context, event: string, request: unknown) => {
      if (event === 'slash/input-insert-text') {
        const { text, span } = request as { text: string; span: TokenSpan }
        const current = state.getSnapshot()
        if (current.phase !== 'plain' || span.draftRev !== current.draftRev) return false
        state.set({ ...current, draft: current.draft.slice(0, span.start) + text + current.draft.slice(span.end), draftRev: current.draftRev + 1 })
        return true
      }
      if (event !== 'slash/input-consume-token') return undefined
      const guard = (request as { guard: { span: TokenSpan } }).guard
      const current = state.getSnapshot()
      if (guard.span.draftRev !== current.draftRev) return undefined
      const { claim: _claim, ...withoutClaim } = current
      state.set({
        ...withoutClaim,
        draft: current.draft.slice(guard.span.end),
        draftRev: current.draftRev + 1,
        phase: 'plain',
      })
      return true
    }),
  } as unknown as Context
  return { input, context, state, beginCommand, submitDefault, claims }
}

async function settleComponent(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('expected clickable element')
  act(() => { element.click() })
}

function changeValue(element: Element | null, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
    throw new Error('expected input or select element')
  }
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error('form control value setter unavailable')
  act(() => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
  })
}

describe('RoboCoding skill catalog client', () => {
  it('keeps the published Bumi skill runnable through the guarded structured run protocol', async () => {
    const bumi = parseRoboCatalog({
      ...catalogPayload,
      mode: 'catalog',
      featuredSkillIds: [],
      skills: [{
        id: 'bumi-sdk-development', displayName: 'Bumi SDK 开发助手', description: '只读预检', version: '0.2.0',
        category: 'engineering', robotIndependent: true, targets: [], demo: false,
      }],
    }).skills[0]!
    const selection = selectionFor(bumi, '', '')
    expect(selection).toEqual({ skillId: 'bumi-sdk-development', skillVersion: '0.2.0' })
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({
      mode: 'local-demo', demo: true, skillId: 'bumi-sdk-development', skillVersion: '0.2.0', output: {
        status: 'ready-for-review', summary: 'Bumi SDK 报告', findings: [{ area: 'environment', level: 'risk', message: '发现异常', evidence: 'traceback' }],
        filePatchProposals: [], commandProposals: [], deviceOperationProposals: [], safetyNotes: ['仅生成提案，未执行'],
      },
    }) })
    const result = await createRoboSkillsApi(fetcher as unknown as typeof fetch).run(selection!, 'noetix_sdk_bumi; config/dds.xml; traceback')
    expect(result.summary).toContain('Bumi SDK')
    expect(result.findings.some(finding => finding.level === 'warning')).toBe(true)
    expect(result.bumi?.status).toBe('ready-for-review')
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/desktop/robo-skills/runs')
  })

  it('parses a valid catalog and filters by robot, category, and every search term', () => {
    expect(catalog.skills).toHaveLength(3)
    expect(catalog.marketRevision).toBe(12)
    expect(catalog.featuredSkillIds).toEqual(['ros-log-summary', 'navigation-diagnostics'])
    expect(catalog.categories[1]).toEqual({ id: 'engineering', name: '工程工具', visible: false })
    expect(filterRoboSkills(catalog, '导航 擎云', '', '')).toEqual([navigationSkill])
    expect(filterRoboSkills(catalog, '', 'qy-a2', 'inspection').map(skill => skill.id)).toEqual([
      'arm-inspection',
    ])
    expect(filterRoboSkills(catalog, 'ROS 工程', 'qy-x1', '').map(skill => skill.id)).toEqual([
      'ros-log-summary',
    ])
    expect(selectionFor(navigationSkill, 'qy-x1', 'factory')).toBeUndefined()
    expect(selectionFor(catalog.skills[2] as RoboSkill, 'qy-x1', 'standard')).toEqual({
      skillId: 'ros-log-summary',
      skillVersion: '0.2.0',
    })
  })

  it('searches public detail text and discards private workflow-shaped fields', () => {
    const details = { overview: '公开的关键词诊断', inputs: ['输入 fatal 文字'], outputs: ['报告'], limitations: ['不连接设备'], steps: ['private-step'], prompt: 'private-prompt', workflow: ['private-workflow'] }
    const enriched = parseRoboCatalog({ ...catalogPayload, featuredSkillIds: ['navigation-diagnostics'], skills: [{ ...catalogPayload.skills[0], details }] })
    expect(filterRoboSkills(enriched, 'fatal', '', '')).toHaveLength(1)
    expect(filterRoboSkills(enriched, 'private-step', '', '')).toHaveLength(0)
    expect(enriched.skills[0]?.details).toEqual({ overview: '公开的关键词诊断', inputs: ['输入 fatal 文字'], outputs: ['报告'], limitations: ['不连接设备'] })
    expect(() => parseRoboCatalog({ ...catalogPayload, featuredSkillIds: ['navigation-diagnostics'], skills: [{ ...catalogPayload.skills[0], details: { ...details, limitations: [1] } }] })).toThrow()
  })

  it('resolves v2 series and component requirements conservatively', () => {
    const robots = catalogPayload.robots.map((robot, index) => index === 0 ? {
      ...robot,
      seriesId: 'qy/x-series',
      profiles: robot.profiles.map((profile, profileIndex) => ({
        ...profile,
        ...(profileIndex === 0 ? { components: { 'qy/sdk': { version: '2.5.0', scheme: 'semver' } } } : {}),
      })),
    } : robot)
    const compatibility = (requirements: unknown[]) => ({
      compatibilitySchemaVersion: 2,
      rules: [{ scope: { kind: 'series', seriesIds: ['qy/x-series'] }, requirements }],
      exclusions: [],
      testedTargets: [{ modelId: 'qy-x1', profileId: 'standard', result: 'passed', testedAt: '2026-09-17', evidence: ['PRIVATE_EVIDENCE'] }],
    })
    const skill = { ...catalogPayload.skills[2], compatibility: compatibility([]) }
    const series = parseRoboCatalog({ ...catalogPayload, robots, skills: [skill], featuredSkillIds: [] }).skills[0]!
    expect(series.robotIndependent).toBe(false)
    expect(series.targets).toEqual([{ modelId: 'qy-x1', profileIds: ['standard', 'lidar'] }])
    expect(series.compatibilitySummary).toEqual({ status: 'targeted', selectableProfiles: 2 })
    expect(series.compatibility?.testedTargets[0]).toEqual({ modelId: 'qy-x1', profileId: 'standard', result: 'passed', testedAt: '2026-09-17' })

    const mismatchRequirement = { componentId: 'qy/sdk', scheme: 'semver', operator: 'exact', value: '9.0.0' }
    const fullyKnownRobots = [{ ...robots[0]!, profiles: robots[0]!.profiles.slice(0, 1) }]
    const mismatch = parseRoboCatalog({ ...catalogPayload, robots: fullyKnownRobots, skills: [{ ...skill, compatibility: compatibility([mismatchRequirement]) }], featuredSkillIds: [] }).skills[0]!
    expect(mismatch.targets).toEqual([])
    expect(mismatch.compatibilitySummary?.status).toBe('mismatch')
    expect(selectionFor(mismatch, 'qy-x1', 'standard')).toBeUndefined()

    const unknownRequirement = { componentId: 'qy/firmware', scheme: 'exact', operator: 'exact', value: 'R1' }
    const unknown = parseRoboCatalog({ ...catalogPayload, robots, skills: [{ ...skill, compatibility: compatibility([unknownRequirement]) }], featuredSkillIds: [] }).skills[0]!
    expect(unknown.targets).toEqual([])
    expect(unknown.compatibilitySummary?.status).toBe('unknown')
    expect(selectionFor(unknown, 'qy-x1', 'standard')).toBeUndefined()
  })

  it('rejects duplicate ids, unknown profiles, and mismatched run responses', () => {
    expect(() => parseRoboCatalog({
      ...catalogPayload,
      robots: [catalogPayload.robots[0], catalogPayload.robots[0], catalogPayload.robots[1]],
    })).toThrow('技能目录存在重复标识')
    expect(() => parseRoboCatalog({
      ...catalogPayload,
      featuredSkillIds: [],
      skills: [{
        ...catalogPayload.skills[0],
        targets: [{ modelId: 'qy-x1', profileIds: ['missing'] }],
      }],
    })).toThrow('技能引用了未知环境')
    expect(() => parseRoboCatalog({ ...catalogPayload, marketRevision: -1 })).toThrow('无效技能市场版本')
    expect(() => parseRoboCatalog({ ...catalogPayload, featuredSkillIds: ['missing'] })).toThrow('精选技能引用无效')
    expect(() => parseRoboCatalog({ ...catalogPayload, categories: [{ id: 'inspection', name: '巡检诊断', visible: 'yes' }] })).toThrow('无效技能分类')
    expect(() => parseRoboResult({
      ...resultFor(navigationSelection),
      skillVersion: '9.9.9',
    }, navigationSelection)).toThrow('技能结果与本次请求不匹配')
  })

  it('uses only the Desktop skill endpoints and validates the returned payload', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(catalogPayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, mode: 'catalog', robots: catalogPayload.robots }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(resultFor(navigationSelection)), { status: 200 }))
    const api = createRoboSkillsApi(fetcher)

    await expect(api.catalog()).resolves.toEqual(catalog)
    await expect(api.devices()).resolves.toEqual(expect.objectContaining({ robots: catalog.robots, categories: [], skills: [] }))
    await expect(api.run(navigationSelection, '检查导航日志')).resolves.toEqual(resultFor(navigationSelection))

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/desktop/robo-skills/catalog', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }))
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/desktop/robo-skills/devices', expect.objectContaining({ method: 'GET' }))
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/desktop/robo-skills/demo-runs', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ...navigationSelection, text: '检查导航日志' }),
    }))
  })

  it('explains when the published catalog is not available yet', async () => {
    const api = createRoboSkillsApi(vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'public skills catalog is not published' }), { status: 503 }),
    ))

    await expect(api.catalog()).rejects.toThrow('技能目录尚未上线或暂时不可用，请稍后刷新')
    await expect(api.devices()).rejects.toThrow('设备目录尚未上线或暂时不可用，请稍后刷新')
  })
})

describe('RoboCoding skill session command', () => {
  it('keeps selections isolated between conversation sessions', () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const first = sessionHarness('第一会话草稿')
    const second = sessionHarness('第二会话草稿')
    const library = skillLibrary(navigationSkill.id)
    const firstSession = createRoboSkillSession(api, first.input, first.context, library)
    const secondSession = createRoboSkillSession(api, second.input, second.context, library)

    expect(firstSession.select(navigationSkill, navigationSelection)).toBe(true)
    expect(firstSession.store.getSnapshot().selection).toEqual(navigationSelection)
    expect(secondSession.store.getSnapshot().selection).toBeUndefined()
    expect(second.state.getSnapshot().draft).toBe('第二会话草稿')

    firstSession.dispose()
    secondSession.dispose()
    library.dispose()
  })

  it('retains the selected skill and draft after a failed local run without using default model submit', async () => {
    const api = {
      catalog: vi.fn(),
      run: vi.fn().mockRejectedValue(new Error('本地服务离线')),
    } as unknown as RoboSkillsApi
    const harness = sessionHarness('待分析日志')
    const library = skillLibrary(navigationSkill.id)
    const session = createRoboSkillSession(api, harness.input, harness.context, library)

    expect(session.select(navigationSkill, navigationSelection)).toBe(true)
    expect(harness.state.getSnapshot().draft).toBe('/navigation-diagnostics 待分析日志')
    expect(session.run()).toBe(true)
    const outcome = await harness.claims[0]?.submit('待分析日志', harness.context, [])

    expect(outcome).toEqual({ kind: 'error', text: '本地服务离线' })
    expect(session.store.getSnapshot()).toEqual(expect.objectContaining({
      selection: navigationSelection,
      skill: navigationSkill,
      error: '本地服务离线',
      running: false,
    }))
    expect(harness.state.getSnapshot().draft).toBe(`${ROBO_SKILL_TOKEN}待分析日志`)
    expect(harness.submitDefault).toHaveBeenCalledOnce()
    expect(api.run).toHaveBeenCalledWith(navigationSelection, '待分析日志', expect.any(AbortSignal))

    session.remove()
    expect(harness.state.getSnapshot().draft).toBe('待分析日志')
    expect(session.store.getSnapshot().selection).toBeUndefined()
    expect(session.store.getSnapshot().error).toBeUndefined()

    session.dispose()
    library.dispose()
  })

  it('clears the selection after success and returns the local result without using default model submit', async () => {
    const localResult = resultFor(navigationSelection)
    const api = {
      catalog: vi.fn(),
      run: vi.fn().mockResolvedValue(localResult),
    } as unknown as RoboSkillsApi
    const harness = sessionHarness('待分析日志')
    const library = skillLibrary(navigationSkill.id)
    const session = createRoboSkillSession(api, harness.input, harness.context, library)

    expect(session.select(navigationSkill, navigationSelection)).toBe(true)
    expect(session.run()).toBe(true)
    const outcome = await harness.claims[0]?.submit('待分析日志', harness.context, [])

    expect(outcome).toEqual({ kind: 'success', text: '技能报告已生成；这条输入未发送给 AI' })
    expect(session.store.getSnapshot()).toEqual(expect.objectContaining({
      selection: undefined,
      skill: undefined,
      result: localResult,
      error: undefined,
      running: false,
    }))
    expect(harness.submitDefault).toHaveBeenCalledOnce()

    session.dispose()
    library.dispose()
  })

  it('removes a pending skill without changing the user draft', () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness('继续保留的说明')
    const library = skillLibrary(navigationSkill.id)
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    expect(session.select(navigationSkill, navigationSelection)).toBe(true)

    session.remove()

    expect(harness.state.getSnapshot().draft).toBe('继续保留的说明')
    expect(session.store.getSnapshot().selection).toBeUndefined()
    expect(harness.submitDefault).not.toHaveBeenCalled()

    session.dispose()
    library.dispose()
  })

  it('keeps a pending skill independent from the ordinary input phase', () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness('切换页面后仍保留')
    const library = skillLibrary(navigationSkill.id)
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    expect(session.select(navigationSkill, navigationSelection)).toBe(true)
    expect(harness.state.getSnapshot().draft).toBe('/navigation-diagnostics 切换页面后仍保留')
    expect(harness.state.getSnapshot().phase).toBe('plain')
    expect(session.store.getSnapshot().selection).toEqual(navigationSelection)
    library.remove(navigationSkill.id)
    expect(session.store.getSnapshot().selection).toBeUndefined()
    session.dispose(); library.dispose()
  })

  it('cleans an owned token before disposal but leaves manually authored text alone', () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const selectedHarness = sessionHarness('返回后不应残留命令')
    const library = skillLibrary(navigationSkill.id)
    const selected = createRoboSkillSession(api, selectedHarness.input, selectedHarness.context, library)
    expect(selected.select(navigationSkill, navigationSelection)).toBe(true)
    selected.dispose()
    expect(selectedHarness.state.getSnapshot().draft).toBe('返回后不应残留命令')

    const manualHarness = sessionHarness(`${ROBO_SKILL_TOKEN}这是用户手写的内容`)
    const manual = createRoboSkillSession(api, manualHarness.input, manualHarness.context, library)
    manual.dispose()
    expect(manualHarness.state.getSnapshot().draft).toBe(`${ROBO_SKILL_TOKEN}这是用户手写的内容`)
    expect(manualHarness.context.bail).not.toHaveBeenCalled()
    library.dispose()
  })

  it('rejects uninstalled skills and clears an active command if the skill is removed', async () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness('草稿仍需保留')
    const library = skillLibrary()
    const session = createRoboSkillSession(api, harness.input, harness.context, library)

    expect(session.select(navigationSkill, navigationSelection)).toBe(false)
    expect(harness.beginCommand).not.toHaveBeenCalled()
    library.add(navigationSkill.id)
    expect(session.select(navigationSkill, navigationSelection)).toBe(true)
    expect(session.run()).toBe(true)
    const submit = harness.claims[0]?.submit

    library.remove(navigationSkill.id)
    expect(session.store.getSnapshot().selection).toBeUndefined()
    expect(harness.state.getSnapshot().draft).toBe('草稿仍需保留')
    await expect(submit?.('不应执行', harness.context, [])).resolves.toEqual(expect.objectContaining({ kind: 'error' }))
    expect(api.run).not.toHaveBeenCalled()

    session.dispose()
    library.dispose()
  })
})

describe('RoboCoding skill picker', () => {
  it('prioritizes an installed cloud skill over a same-named local slash skill', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe(): void {}; unobserve(): void {}; disconnect(): void {} })
    const bumiCatalog = parseRoboCatalog({
      ...catalogPayload,
      featuredSkillIds: [],
      skills: [{
        id: 'bumi-sdk-development', displayName: 'Bumi SDK 开发助手', description: '云端 Bumi 只读预检',
        version: '0.2.0', category: 'engineering', robotIndependent: true, targets: [], demo: true,
      }],
    })
    vi.mocked(roboLocalSkillsApi.list).mockResolvedValue([
      { name: 'bumi-sdk-development', description: '本地同名技能', path: '/local/bumi/SKILL.md' },
      { name: 'local-helper', description: '本地助手', path: '/local/helper/SKILL.md' },
    ])
    const api = { catalog: vi.fn().mockResolvedValue(bumiCatalog), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness('Bumi 日志')
    const library = skillLibrary('bumi-sdk-development')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillPicker, { api, session, library, openMarket: vi.fn() })) })
      click(document.querySelector('[aria-label="选择技能"]')); await settleComponent()
      const rows = [...document.querySelectorAll('[aria-label="技能列表"] > button')]
      expect(rows[0]?.textContent).toContain('Bumi SDK 开发助手')
      expect(rows.some(row => row.textContent?.includes('本地同名技能'))).toBe(false)
      expect(rows.some(row => row.textContent?.includes('local-helper'))).toBe(true)
      click(rows[0] ?? null)
      expect(harness.state.getSnapshot().draft).toBe('/bumi-sdk-development Bumi 日志')
      expect(session.store.getSnapshot().selection?.skillId).toBe('bumi-sdk-development')
      click(container.querySelector('[aria-label="移除技能"]'))
      expect(harness.state.getSnapshot().draft).toBe('Bumi 日志')
    } finally {
      await act(async () => { root.unmount() }); session.dispose(); library.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('persists owned-token cleanup before the parent draft mirror unbinds', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const api = { catalog: vi.fn().mockResolvedValue(catalog), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness('Ubuntu ROS SDK cmake')
    const library = skillLibrary('ros-log-summary')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const generic = catalog.skills.find(skill => skill.id === 'ros-log-summary')!
    expect(session.select(generic, selectionFor(generic, '', '')!)).toBe(true)
    let persistedDraft = harness.state.getSnapshot().draft

    function MirrorParent({ children }: { readonly children?: ReactNode }) {
      useEffect(() => harness.state.subscribe(() => { persistedDraft = harness.state.getSnapshot().draft }), [])
      return children
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => { root.render(createElement(MirrorParent, {}, createElement(RoboSkillPicker, {
      api, session, library, openMarket: vi.fn(),
    }))) })
    await act(async () => { root.unmount() })

    expect(harness.state.getSnapshot().draft).toBe('Ubuntu ROS SDK cmake')
    expect(persistedDraft).toBe('Ubuntu ROS SDK cmake')
    expect(session.store.getSnapshot().selection).toBeUndefined()
    session.dispose(); library.dispose(); container.remove(); vi.unstubAllGlobals()
  })

  it('loads, searches, clears, closes, and enforces device-model and development-method selection', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    let releaseCatalog: ((value: RoboCatalog) => void) | undefined
    const pendingCatalog = new Promise<RoboCatalog>(resolve => { releaseCatalog = resolve })
    const api = {
      catalog: vi.fn()
        .mockImplementationOnce(() => pendingCatalog)
        .mockResolvedValue(catalog),
      run: vi.fn(),
    } as unknown as RoboSkillsApi
    const harness = sessionHarness('组件测试草稿')
    const library = skillLibrary(...catalog.skills.map(skill => skill.id))
    const device = createRoboDeviceSelection({ getItem: () => null, setItem: () => {} })
    device.select('qy-x1', 'standard')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const openMarket = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => { root.render(createElement(RoboSkillPicker, { api, session, library, device, openMarket })) })

      click(document.querySelector('[aria-label="选择技能"]'))
      expect(document.body.textContent).toContain('正在读取技能目录…')
      await act(async () => { releaseCatalog?.(catalog); await pendingCatalog })
      await settleComponent()
      expect(api.catalog).toHaveBeenCalledTimes(1)
      expect(document.querySelector('[aria-label="搜索技能"]')).not.toBeNull()
      expect(document.body.textContent).toContain('导航日志诊断')
      expect(document.querySelector('[aria-label="技能列表"]')?.textContent).toContain('分析定位和导航日志')
      expect(document.body.textContent).toContain('ROS 日志摘要')

      changeValue(document.querySelector('[aria-label="搜索技能"]'), '不存在的技能')
      expect(document.body.textContent).toContain('没有匹配的技能')
      click([...document.querySelectorAll('button')].find(button => button.textContent === '清除搜索') ?? null)
      expect(document.body.textContent).toContain('导航日志诊断')

      click(document.querySelector('[aria-label="关闭技能选择器"]'))
      await settleComponent()
      expect(document.querySelector('[aria-label="关闭技能选择器"]')).toBeNull()

      click(document.querySelector('[aria-label="选择技能"]'))
      await settleComponent()
      click([...document.querySelectorAll('button')].find(button => button.textContent?.includes('ROS 日志摘要')) ?? null)
      expect(container.textContent).toContain('ROS 日志摘要')
      expect(session.store.getSnapshot().selection).toEqual({
        skillId: 'ros-log-summary',
        skillVersion: '0.2.0',
      })

      click(container.querySelector('[aria-label="移除技能"]'))
      expect(container.querySelector('[aria-label="移除技能"]')).toBeNull()
      expect(harness.state.getSnapshot().draft).toBe('组件测试草稿')

      click(document.querySelector('[aria-label="选择技能"]'))
      await settleComponent()
      click([...document.querySelectorAll('button')].find(button => button.textContent?.includes('导航日志诊断')) ?? null)
      expect(document.querySelector('[aria-label="当前设备的技能详情"]')).not.toBeNull()
      expect(document.querySelector('[aria-label="技能设备型号"]')).toBeNull()
      expect(document.querySelector('[aria-label="技能开发方式"]')).toBeNull()
      expect(document.body.textContent).not.toContain('运行环境')
      const robotUse = [...document.querySelectorAll('button')].find(button => button.textContent === '使用此技能')
      expect(robotUse?.hasAttribute('disabled')).toBe(false)
      click(robotUse ?? null)
      expect(session.store.getSnapshot().selection).toEqual(navigationSelection)
      expect(container.textContent).toContain('导航日志诊断')
      expect(harness.state.getSnapshot().draft).toBe('/navigation-diagnostics 组件测试草稿')
      expect(container.querySelector('[aria-label="运行技能"]')).toBeNull()
      click(container.querySelector('[aria-label="移除技能"]'))
      expect(harness.state.getSnapshot().draft).toBe('组件测试草稿')
    } finally {
      await act(async () => { root.unmount() })
      session.dispose()
      library.dispose()
      device.dispose()
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('starts empty, hides catalog skills, and links to the market', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe(): void {}; unobserve(): void {}; disconnect(): void {} })
    const api = { catalog: vi.fn().mockResolvedValue(catalog), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness()
    const library = skillLibrary()
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const openMarket = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillPicker, { api, session, library, openMarket })) })
      click(document.querySelector('[aria-label="选择技能"]'))
      await settleComponent()
      expect(document.body.textContent).toContain('还没有添加技能')
      expect(document.body.textContent).not.toContain('导航日志诊断')
      click([...document.querySelectorAll('button')].find(button => button.textContent === '打开技能市场') ?? null)
      expect(openMarket).toHaveBeenCalledOnce()
    } finally {
      await act(async () => { root.unmount() })
      session.dispose(); library.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })

  it('shows published catalog skills but does not offer or invoke demo execution', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe(): void {}; unobserve(): void {}; disconnect(): void {} })
    const published = parseRoboCatalog({
      ...catalogPayload,
      mode: 'catalog',
      skills: catalogPayload.skills.map(skill => ({ ...skill, demo: false })),
    })
    const api = { catalog: vi.fn().mockResolvedValue(published), run: vi.fn() } as unknown as RoboSkillsApi
    const harness = sessionHarness()
    const library = skillLibrary('navigation-diagnostics')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillPicker, { api, session, library, openMarket: vi.fn() })) })
      click(document.querySelector('[aria-label="选择技能"]')); await settleComponent()
      expect(document.body.textContent).toContain('目录展示')
      click([...document.querySelectorAll('button')].find(button => button.textContent?.includes('导航日志诊断')) ?? null)
      const unavailable = [...document.querySelectorAll('button')].find(button => button.textContent === '暂不可运行')
      expect(unavailable?.hasAttribute('disabled')).toBe(true)
      expect(session.store.getSnapshot().selection).toBeUndefined()
      expect(api.run).not.toHaveBeenCalled()
    } finally {
      await act(async () => { root.unmount() }); session.dispose(); library.dispose(); container.remove(); vi.unstubAllGlobals()
    }
  })
})


describe('local skill conversation selection', () => {
  it('uses the native slash skill input while preserving draft and refusing foreign commands', () => {
    const api = { catalog: vi.fn(), run: vi.fn() } as unknown as RoboSkillsApi
    const library = skillLibrary()
    const harness = sessionHarness('帮我分析日志')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    expect(session.selectLocal('local-helper')).toBe(true)
    expect(harness.state.getSnapshot().draft).toBe('/local-helper 帮我分析日志')
    expect(harness.state.getSnapshot().phase).toBe('plain')
    expect(harness.submitDefault).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    expect(session.selectLocal('another-helper')).toBe(false)
    expect(session.selectLocal('../invalid')).toBe(false)
    expect(harness.state.getSnapshot().draft).toBe('/local-helper 帮我分析日志')
    session.dispose(); library.dispose()
  })

  it('selects an imported local skill from the conversation menu even if the market is offline', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.mocked(roboLocalSkillsApi.list).mockResolvedValue([{ name: 'local-helper', description: '本地助手', path: '/local/SKILL.md' }])
    const api = { catalog: vi.fn().mockRejectedValue(new Error('市场离线')), run: vi.fn() } as unknown as RoboSkillsApi
    const library = skillLibrary()
    const harness = sessionHarness('保持草稿')
    const session = createRoboSkillSession(api, harness.input, harness.context, library)
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(RoboSkillPicker, { api, session, library, openMarket: vi.fn() })) })
      click(document.querySelector('[aria-label="选择技能"]')); await settleComponent()
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('local-helper'))
      expect(button?.closest('[aria-label="技能列表"]')).not.toBeNull(); click(button ?? null); await settleComponent()
      expect(harness.state.getSnapshot().draft).toBe('/local-helper 保持草稿')
      expect(api.run).not.toHaveBeenCalled()
    } finally { await act(async () => { root.unmount() }); session.dispose(); library.dispose(); container.remove(); vi.unstubAllGlobals() }
  })
})

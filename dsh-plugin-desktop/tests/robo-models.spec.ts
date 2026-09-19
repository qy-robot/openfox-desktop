// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoboModelsSection } from '../src/client/RoboModelsSection.tsx'
import type { RoboCodingAccountApi } from '../src/client/robocoding-account-api.ts'
import {
  createRoboModelsApi, detectRoboModelProtocol, endpointProtocolHint,
  normalizeRoboModelBaseURL, type RoboCustomProvider, type RoboModelsApi, type RoboModelsView,
} from '../src/client/robo-models-api.ts'

const namespace = (ns: string, value: object, user: object | undefined, revision: number) => ({
  ns, schema: {}, value, ...(user === undefined ? {} : { user }), applies: 'live' as const, secrets: [], revision,
})
const ok = <T,>(value: T) => ({ ok: true as const, value })

function remoteHarness(providerValues: Record<string, unknown> = {}) {
  const providers = namespace('llm-pi-ai', { providers: providerValues }, { providers: providerValues }, 7)
  const defaults = namespace('agent-default-model', { provider: 'robocoding', model: 'official' }, undefined, 3)
  const mutate = vi.fn(async (ns: string, _ops: unknown[], _revision: number) => ok(ns === 'llm-pi-ai' ? { ...providers, revision: 8 } : { ...defaults, revision: 4 }))
  const set = vi.fn<() => Promise<{ ok: true; value: undefined } | { ok: false; error: { message: string } }>>(async () => ok(undefined))
  const unset = vi.fn(async () => ok(undefined))
  const discoverModels = vi.fn(async () => ok([{ id: 'model-a', name: 'Model A' }]))
  const modelCatalog = vi.fn<() => Promise<{ ok: true; value: { groups: { id: string; models: { id: string; name: string }[] }[]; failures: never[] } } | { ok: false; error: { message: string } }>>(async () => ok({ groups: [{ id: 'robocoding', models: [{ id: 'official', name: 'Official' }] }], failures: [] }))
  const context = { remote: {
    settings: { describe: vi.fn(async () => ok({ writable: true, namespaces: [providers, defaults] })), mutate },
    credentials: { describe: vi.fn(async () => ok({})), set, unset },
    llm: { discoverModels },
    session: { modelCatalog },
  } } as unknown as Context
  return { api: createRoboModelsApi(context), mutate, set, unset, discoverModels, modelCatalog }
}

describe('OpenFox custom-model API', () => {
  it('normalizes pasted operation URLs without dropping gateway path prefixes', () => {
    expect(endpointProtocolHint('https://host/acme/v1/chat/completions')).toBe('openai-completions')
    expect(normalizeRoboModelBaseURL('https://host/acme/v1/chat/completions/', 'openai-completions')).toBe('https://host/acme/v1')
    expect(normalizeRoboModelBaseURL('https://host/proxy/messages', 'anthropic-messages')).toBe('https://host/proxy')
    expect(normalizeRoboModelBaseURL('https://host/proxy/v1/messages', 'anthropic-messages')).toBe('https://host/proxy')
  })

  it('reports OpenAI discovery as ambiguous instead of claiming Chat or Responses compatibility', async () => {
    const result = await detectRoboModelProtocol('https://host/v1', async api => {
      if (api === 'anthropic-messages') throw new Error('not anthropic')
      return [{ id: 'served-model' }]
    })
    expect(result).toMatchObject({ kind: 'ambiguous', candidates: ['openai-completions', 'openai-responses'] })
    expect(result.message).toContain('无法区分')
  })

  it('uses CAS and stores the public provider profile separately from the credential', async () => {
    const { api, mutate, set } = remoteHarness()
    await api.save({
      route: 'my-gateway', displayName: 'My Gateway', baseURL: 'https://host/v1/chat/completions',
      api: 'openai-completions', models: [{ id: 'model-a' }], apiKey: ' secret ',
    }, 7)
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'set', path: ['providers', 'my-gateway'], value: {
      displayName: 'My Gateway', api: 'openai-completions', baseURL: 'https://host/v1',
      models: [{ id: 'model-a' }],
    } }], 7)
    expect(set).toHaveBeenCalledWith('MY_GATEWAY_API_KEY', 'secret')
    expect(mutate.mock.calls[1]).toEqual(['llm-pi-ai', [{ op: 'set', path: ['providers', 'my-gateway', 'apiKeyEnv'], value: 'MY_GATEWAY_API_KEY' }], 8])
  })

  it('keeps an existing credential on a same-endpoint blank edit and refuses reuse after an endpoint change', async () => {
    const existing: RoboCustomProvider = {
      route: 'mine', displayName: 'Mine', baseURL: 'https://old/v1', api: 'openai-completions',
      models: [{ id: 'm' }], apiKeyEnv: 'MINE_API_KEY', credentialConfigured: true,
    }
    const { api, mutate, set } = remoteHarness()
    await api.save({ ...existing, apiKey: '', displayName: 'Renamed' }, 7, existing)
    expect(set).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[1]).toContainEqual({ op: 'set', path: ['providers', 'mine', 'apiKeyEnv'], value: 'MINE_API_KEY' })
    await expect(api.save({ ...existing, baseURL: 'https://new/v1', apiKey: '' }, 7, existing)).rejects.toThrow('重新填写 API Key')
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('detaches an old credential before changing endpoints and only reattaches it after storing the new key', async () => {
    const existing: RoboCustomProvider = {
      route: 'mine', displayName: 'Mine', baseURL: 'https://old/v1', api: 'openai-completions',
      models: [{ id: 'm' }], apiKeyEnv: 'MINE_API_KEY', credentialConfigured: true,
    }
    const { api, mutate, set } = remoteHarness()
    await api.save({ ...existing, baseURL: 'https://new/v1', apiKey: 'new-key' }, 7, existing)
    expect(mutate.mock.calls[0]?.[1]).toContainEqual({ op: 'unset', path: ['providers', 'mine', 'apiKeyEnv'] })
    expect(set).toHaveBeenCalledWith('MINE_API_KEY_2', 'new-key')
    expect(mutate.mock.calls[1]).toEqual(['llm-pi-ai', [{ op: 'set', path: ['providers', 'mine', 'apiKeyEnv'], value: 'MINE_API_KEY_2' }], 8])
  })

  it('preserves advanced and redacted fields when editing the visible service name', async () => {
    const existing: RoboCustomProvider = { route: 'mine', displayName: 'Mine', baseURL: 'https://old/v1', api: 'openai-completions', models: [{ id: 'm' }], apiKeyEnv: 'MINE_API_KEY', credentialConfigured: true }
    const { api, mutate } = remoteHarness({ mine: { ...existing, headers: { 'x-private': 'redacted' }, models: [{ id: 'm', contextWindow: 32000 }] } })
    await api.save({ ...existing, displayName: 'Renamed', apiKey: '' }, 7, existing)
    const ops = mutate.mock.calls[0]?.[1] as { path: string[] }[]
    expect(ops.every(op => op.path.length === 3)).toBe(true)
    expect(ops.some(op => ['headers', 'models'].includes(op.path[2]!))).toBe(false)
  })

  it('requires a usable key before a new model is exposed to generation', async () => {
    const { api, mutate } = remoteHarness()
    await expect(api.save({ route: 'local', displayName: 'Local', baseURL: 'http://127.0.0.1:8080/v1', api: 'openai-completions', apiKey: '', models: [{ id: 'm' }] }, 7)).rejects.toThrow('请填写 API Key')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('refuses a new route that would shadow an existing provider', async () => {
    const { api, mutate } = remoteHarness({
      existing: { displayName: 'Existing', api: 'openai-completions', baseURL: 'https://old/v1', models: [{ id: 'm' }] },
    })
    await expect(api.save({
      route: 'existing', displayName: 'Replacement', baseURL: 'https://new/v1',
      api: 'openai-completions', models: [{ id: 'new' }], apiKey: '',
    }, 7)).rejects.toThrow('服务标识已存在')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('keeps custom settings usable when the official model catalog is unavailable', async () => {
    const harness = remoteHarness()
    harness.modelCatalog.mockResolvedValueOnce({ ok: false, error: { message: '账户未登录' } })
    await expect(harness.api.load()).resolves.toMatchObject({ providers: [], officialModels: [], officialModelsError: '账户未登录' })
  })

  it('reports a partial save and never hides a credential failure', async () => {
    const { api, mutate, set } = remoteHarness()
    set.mockResolvedValueOnce({ ok: false, error: { message: '凭据存储只读' } })
    await expect(api.save({
      route: 'my-gateway', displayName: 'My Gateway', baseURL: 'https://host/v1',
      api: 'openai-completions', models: [{ id: 'model-a' }], apiKey: 'secret',
    }, 7)).rejects.toThrow('模型服务配置已保存，但 API Key 保存失败')
    expect(mutate).toHaveBeenCalledOnce()
  })
})

let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; container?.remove(); container = undefined; vi.unstubAllGlobals() })

function input(label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].find(item => item.getAttribute('aria-label') === label || document.querySelector(`label[for="${item.id}"]`)?.textContent === label)
  if (found === undefined) throw new Error(`missing ${label}`)
  return found
}
function change(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => { setter?.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function settle(): Promise<void> { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

describe('OpenFox custom-model GUI', () => {
  it('switches the default model across services and preserves read-only controls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let view: RoboModelsView = {
      writable: true, providersRevision: 7, defaultRevision: 3,
      defaultSelection: { provider: 'robocoding', model: 'official' },
      officialModels: [{ id: 'official', name: 'Official' }],
      providers: [{ route: 'mine', displayName: 'Mine', baseURL: 'https://host/v1', api: 'openai-completions', credentialConfigured: true, models: [{ id: 'custom', name: 'Custom' }] }],
    }
    const setDefault = vi.fn(async (provider: string, model: string) => {
      view = { ...view, defaultSelection: { provider, model } }
    })
    const api: RoboModelsApi = { load: vi.fn(async () => view), discover: vi.fn(), save: vi.fn(), remove: vi.fn(), setDefault }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => { root!.render(createElement(RoboModelsSection, { api, accountApi: {} as RoboCodingAccountApi })) }); await settle()
    const disclosure = container.querySelector<HTMLDetailsElement>('.roboModelsProvider details')
    expect(disclosure?.open).toBe(false)
    expect(disclosure?.querySelector('summary')?.textContent).toContain('1')
    act(() => { disclosure!.open = true })
    const custom = container.querySelector<HTMLButtonElement>('button[aria-label="Custom · 设为默认"]')
    expect(custom).not.toBeNull()
    await act(async () => { custom!.click() }); await settle()
    expect(setDefault).toHaveBeenCalledWith('mine', 'custom', 3)
    expect(container.querySelector('button[aria-label="Custom · 设为默认"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Official · 设为默认"]')).not.toBeNull()
    view = { ...view, writable: false }
    await act(async () => { root!.unmount(); root = createRoot(container!); root.render(createElement(RoboModelsSection, { api, accountApi: {} as RoboCodingAccountApi })) }); await settle()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Official · 设为默认"]')?.disabled).toBe(true)
  })

  it('submits a manually entered provider and exposes the official account route', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const view: RoboModelsView = { writable: true, providersRevision: 7, defaultRevision: 3, providers: [], officialModels: [] }
    const save = vi.fn(async () => undefined)
    const accountApi = {} as RoboCodingAccountApi
    const api: RoboModelsApi = {
      load: vi.fn(async () => view), discover: vi.fn(), save,
      remove: vi.fn(), setDefault: vi.fn(),
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => { root!.render(createElement(RoboModelsSection, { api, accountApi })) }); await settle()
    expect([...container.querySelectorAll('button')].some(item => item.textContent === '账户设置')).toBe(true)
    act(() => { [...container!.querySelectorAll('button')].find(item => item.textContent === '添加模型服务')?.click() })
    change(input('服务标识'), 'private-gateway'); change(input('显示名称'), '私有服务')
    change(input('API 地址'), 'https://gateway.example/v1'); change(input('API Key'), 'sk-test')
    expect(input('API Key').getAttribute('placeholder')).toBe('填写 API Key')
    expect(container.textContent).not.toContain('本地无鉴权测试')
    change(input('模型型号'), 'model-one | 一号模型')
    await act(async () => { container!.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      route: 'private-gateway', displayName: '私有服务', baseURL: 'https://gateway.example/v1', apiKey: 'sk-test',
      models: [{ id: 'model-one', name: '一号模型' }],
    }), 7, undefined)
  })

  it('requires an explicit protocol choice after ambiguous automatic detection', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const view: RoboModelsView = { writable: true, providersRevision: 7, defaultRevision: 3, providers: [], officialModels: [] }
    const api: RoboModelsApi = {
      load: vi.fn(async () => view),
      discover: vi.fn(async () => [{ id: 'model-a' }]),
      save: vi.fn(), remove: vi.fn(), setDefault: vi.fn(),
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => { root!.render(createElement(RoboModelsSection, { api, accountApi: {} as RoboCodingAccountApi })) }); await settle()
    act(() => { [...container!.querySelectorAll('button')].find(item => item.textContent === '添加模型服务')?.click() })
    change(input('API 地址'), 'https://gateway.example/v1')
    await act(async () => { [...container!.querySelectorAll('button')].find(item => item.textContent === '自动判断')?.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    const saveButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '保存模型服务')
    expect(saveButton?.disabled).toBe(true)
    expect(container.querySelector('input[type=radio]:checked')).toBeNull()
    const responses = container.querySelector<HTMLInputElement>('input[value="openai-completions"]')
    act(() => { responses?.click() })
    expect(saveButton?.disabled).toBe(false)
  })
})

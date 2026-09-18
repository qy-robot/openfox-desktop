import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { LlmDiscoveredModel, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

export const ROBO_MODEL_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const
export type RoboModelProtocol = typeof ROBO_MODEL_PROTOCOLS[number]

export interface RoboModelEntry { readonly id: string; readonly name?: string }
export interface RoboCustomProvider {
  readonly route: string
  readonly displayName: string
  readonly baseURL: string
  readonly api: RoboModelProtocol
  readonly models: readonly RoboModelEntry[]
  readonly apiKeyEnv?: string
  readonly credentialConfigured: boolean | undefined
}
export interface RoboModelsView {
  readonly writable: boolean
  readonly providersRevision: number
  readonly defaultRevision: number
  readonly providers: readonly RoboCustomProvider[]
  readonly officialModels: readonly RoboModelEntry[]
  readonly officialModelsError?: string
  readonly credentialError?: string
  readonly defaultSelection?: { readonly provider: string; readonly model: string }
}
export interface RoboProviderDraft {
  readonly route: string
  readonly displayName: string
  readonly baseURL: string
  readonly api: RoboModelProtocol
  readonly models: readonly RoboModelEntry[]
  readonly apiKey: string
}
export interface ProtocolDetection {
  readonly kind: 'detected' | 'ambiguous' | 'failed'
  readonly candidates: readonly RoboModelProtocol[]
  readonly models: readonly LlmDiscoveredModel[]
  readonly message: string
}

export class RoboPartialModelSaveError extends Error {
  constructor(message: string, readonly provider: RoboCustomProvider, readonly revision: number) {
    super(message); this.name = 'RoboPartialModelSaveError'
  }
}

type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }
type RemoteContext = ClientContext & {
  remote: {
    settings: {
      describe(): Promise<RemoteResult<{ writable: boolean; namespaces: SettingsNamespaceView[] }>>
      mutate(ns: string, ops: SettingsPathOpView[], revision: number | undefined): Promise<RemoteResult<SettingsNamespaceView>>
    }
    credentials: {
      describe(refs: string[]): Promise<RemoteResult<Record<string, { configured: boolean }>>>
      set(ref: string, value: string): Promise<RemoteResult<void>>
      unset(ref: string): Promise<RemoteResult<void>>
    }
    llm: {
      discoverModels(ns: string, request: { baseURL: string; api: string; apiKey?: string }): Promise<RemoteResult<readonly LlmDiscoveredModel[]>>
    }
    session: {
      modelCatalog(): Promise<RemoteResult<{
        groups: readonly { id: string; models: readonly { id: string; name: string }[] }[]
        failures: readonly { id: string; message: string }[]
      }>>
    }
  }
}

const ROUTE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function unwrap<T>(result: RemoteResult<T>): T { if (result.ok) return result.value; throw new Error(result.error.message) }
function namespace(views: readonly SettingsNamespaceView[], ns: string): SettingsNamespaceView {
  const found = views.find(view => view.ns === ns)
  if (found === undefined) throw new Error(`当前运行环境未启用 ${ns} 设置服务`)
  return found
}
function protocol(value: unknown): RoboModelProtocol | undefined {
  return ROBO_MODEL_PROTOCOLS.find(candidate => candidate === value)
}
function credentialRefs(value: unknown, refs = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(value)) { for (const item of value) credentialRefs(item, refs); return refs }
  const object = record(value); if (object === undefined) return refs
  if (typeof object.apiKeyEnv === 'string') refs.set(object.apiKeyEnv, (refs.get(object.apiKeyEnv) ?? 0) + 1)
  for (const child of Object.values(object)) credentialRefs(child, refs)
  return refs
}

export function deriveRoboModelKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

export function endpointProtocolHint(value: string): RoboModelProtocol | undefined {
  const path = (() => { try { return new URL(value.trim()).pathname.replace(/\/+$/, '') } catch { return '' } })()
  if (path.endsWith('/chat/completions')) return 'openai-completions'
  if (path.endsWith('/responses')) return 'openai-responses'
  if (path.endsWith('/messages')) return 'anthropic-messages'
  return undefined
}

export function normalizeRoboModelBaseURL(value: string, api: RoboModelProtocol): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const suffix = api === 'openai-completions' ? '/chat/completions' : api === 'openai-responses' ? '/responses' : trimmed.endsWith('/v1/messages') ? '/v1/messages' : '/messages'
  return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed
}

export function validateRoboProviderDraft(draft: RoboProviderDraft): string | undefined {
  if (!ROUTE.test(draft.route)) return '服务标识需以小写字母开头，只能包含小写字母、数字和连字符'
  if (draft.displayName.trim() === '') return '请填写服务名称'
  try {
    const parsed = new URL(normalizeRoboModelBaseURL(draft.baseURL, draft.api))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '服务地址只支持 HTTP 或 HTTPS'
    if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return '服务地址不能包含账号、密码、查询参数或片段'
  } catch { return '请输入完整的服务地址' }
  if (draft.models.length === 0 || draft.models.some(model => model.id.trim() === '')) return '请至少填写一个模型型号'
  if (new Set(draft.models.map(model => model.id.trim())).size !== draft.models.length) return '模型型号不能重复'
  return undefined
}

export async function detectRoboModelProtocol(
  baseURL: string,
  discover: (api: RoboModelProtocol) => Promise<readonly LlmDiscoveredModel[]>,
): Promise<ProtocolDetection> {
  const hinted = endpointProtocolHint(baseURL)
  if (hinted !== undefined) {
    try {
      const models = await discover(hinted)
      return { kind: 'detected', candidates: [hinted], models, message: `已根据完整接口地址识别为 ${hinted}` }
    } catch (error) {
      return { kind: 'failed', candidates: [hinted], models: [], message: messageOf(error) }
    }
  }
  const attempts = await Promise.allSettled([
    discover('openai-completions'),
    discover('anthropic-messages'),
  ])
  const openai = attempts[0]
  const anthropic = attempts[1]
  if (openai.status === 'fulfilled' && anthropic.status === 'fulfilled') {
    return {
      kind: 'ambiguous', candidates: [...ROBO_MODEL_PROTOCOLS], models: openai.value,
      message: '该地址同时响应 OpenAI 与 Anthropic 的模型列表，请手动选择实际生成协议。',
    }
  }
  if (anthropic.status === 'fulfilled') {
    return { kind: 'detected', candidates: ['anthropic-messages'], models: anthropic.value, message: '已识别为 Anthropic Messages' }
  }
  if (openai.status === 'fulfilled') {
    return {
      kind: 'ambiguous', candidates: ['openai-completions', 'openai-responses'], models: openai.value,
      message: '已识别为 OpenAI 协议族；模型列表无法区分 Chat Completions 与 Responses，请手动选择。',
    }
  }
  const reasons = attempts.map(result => result.status === 'rejected' ? messageOf(result.reason) : '').filter(Boolean)
  return { kind: 'failed', candidates: [], models: [], message: reasons.join('；') || '未能读取模型列表' }
}

function parseModels(value: unknown): RoboModelEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const row = record(item); const id = row?.id
    if (typeof id !== 'string' || id === '') return []
    return [{ id, ...(typeof row?.name === 'string' && row.name !== '' ? { name: row.name } : {}) }]
  })
}

export interface RoboModelsApi {
  load(): Promise<RoboModelsView>
  discover(baseURL: string, api: RoboModelProtocol, apiKey: string): Promise<readonly LlmDiscoveredModel[]>
  save(draft: RoboProviderDraft, openedRevision: number, original?: RoboCustomProvider): Promise<void>
  remove(provider: RoboCustomProvider, openedRevision: number): Promise<void>
  setDefault(provider: string, model: string, openedRevision: number): Promise<void>
}

export function createRoboModelsApi(context: ClientContext): RoboModelsApi {
  const ctx = context as RemoteContext
  const mutate = async (ns: string, ops: SettingsPathOpView[], revision: number): Promise<SettingsNamespaceView> =>
    unwrap(await ctx.remote.settings.mutate(ns, ops, revision))
  const unusedCredentialRef = async (stem: string, referenced: ReadonlyMap<string, number>): Promise<string> => {
    for (let suffix = 1; suffix <= 100; suffix += 1) {
      const candidate = suffix === 1 ? stem : `${stem}_${String(suffix)}`
      if (referenced.has(candidate)) continue
      const answer = await ctx.remote.credentials.describe([candidate])
      if (!answer.ok) throw new Error(`无法确认 API Key 存储位置是否可用：${answer.error.message}`)
      if (answer.value[candidate]?.configured !== true) return candidate
    }
    throw new Error('无法分配独立的 API Key 存储位置，请更换服务标识')
  }
  return {
    async load() {
      const described = unwrap(await ctx.remote.settings.describe())
      const catalog = await ctx.remote.session.modelCatalog().catch((error: unknown) => ({
        ok: false as const, error: { message: messageOf(error) },
      }))
      const providerNs = namespace(described.namespaces, 'llm-pi-ai')
      const defaultNs = namespace(described.namespaces, 'agent-default-model')
      const userProviders = record(record(providerNs.user)?.providers) ?? {}
      const resolvedProviders = record(record(providerNs.value)?.providers) ?? {}
      const refs = Object.keys(userProviders).flatMap(route => {
        const ref = record(resolvedProviders[route])?.apiKeyEnv
        return typeof ref === 'string' ? [ref] : []
      })
      const credentialResponse = refs.length === 0 ? okEmptyCredentials() : await ctx.remote.credentials.describe([...new Set(refs)])
      const credentials = credentialResponse.ok ? credentialResponse.value : {}
      const providers = Object.keys(userProviders).flatMap(route => {
        const profile = record(resolvedProviders[route]); const api = protocol(profile?.api)
        if (profile === undefined || api === undefined || typeof profile.baseURL !== 'string') return []
        const apiKeyEnv = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
        return [{
          route,
          displayName: typeof profile.displayName === 'string' ? profile.displayName : route,
          baseURL: profile.baseURL,
          api,
          models: parseModels(profile.models),
          ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
          credentialConfigured: apiKeyEnv === undefined
            ? false
            : credentialResponse.ok ? credentials[apiKeyEnv]?.configured === true : undefined,
        }]
      })
      const defaultValue = record(defaultNs.value)
      const defaultSelection = typeof defaultValue?.provider === 'string' && typeof defaultValue.model === 'string'
        ? { provider: defaultValue.provider, model: defaultValue.model } : undefined
      const officialGroup = catalog.ok ? catalog.value.groups.find(group => group.id === 'robocoding') : undefined
      const officialFailure = catalog.ok ? catalog.value.failures.find(failure => failure.id === 'robocoding')?.message : catalog.error.message
      return {
        writable: described.writable,
        providersRevision: providerNs.revision,
        defaultRevision: defaultNs.revision,
        providers,
        officialModels: officialGroup?.models.map(model => ({ id: model.id, name: model.name })) ?? [],
        ...(officialFailure === undefined ? {} : { officialModelsError: officialFailure }),
        ...credentialResponse.ok ? {} : { credentialError: credentialResponse.error.message },
        ...(defaultSelection === undefined ? {} : { defaultSelection }),
      }
    },
    async discover(baseURL, api, apiKey) {
      const invalid = validateRoboProviderDraft({ route: 'discovery', displayName: 'Discovery', baseURL, api, apiKey, models: [{ id: 'probe' }] })
      if (invalid !== undefined) throw new Error(invalid)
      const request = {
        baseURL: normalizeRoboModelBaseURL(baseURL, api), api,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
      }
      try { return unwrap(await ctx.remote.llm.discoverModels('llm-pi-ai', request)) }
      catch { throw new Error('无法获取模型列表，请检查服务地址、协议、API Key 和网络连接') }
    },
    async save(draft, openedRevision, original) {
      const failure = validateRoboProviderDraft(draft)
      if (failure !== undefined) throw new Error(failure)
      const baseURL = normalizeRoboModelBaseURL(draft.baseURL, draft.api)
      const key = draft.apiKey.trim()
      const endpointChanged = original !== undefined && original.baseURL !== baseURL
      if (endpointChanged && original.credentialConfigured !== false && key === '') {
        throw new Error('服务地址已改变，请重新填写 API Key，避免把已保存的密钥发送到新地址')
      }
      const described = unwrap(await ctx.remote.settings.describe())
      const providerNs = namespace(described.namespaces, 'llm-pi-ai')
      if (providerNs.revision !== openedRevision) throw new Error('模型设置已在其他窗口更新，请重新打开编辑器后再保存')
      const resolvedProviders = record(record(providerNs.value)?.providers) ?? {}
      if (original === undefined && resolvedProviders[draft.route] !== undefined) throw new Error('该服务标识已存在，请换一个名称')
      const refs = new Map<string, number>()
      for (const view of described.namespaces) credentialRefs(view.value, refs)
      const existingRef = original?.apiKeyEnv
      if (key === '' && existingRef === undefined) throw new Error('请填写 API Key；本地无鉴权测试服务可填写 local 占位值')
      if (existingRef !== undefined && !refs.has(existingRef)) refs.set(existingRef, 1)
      const refIsShared = existingRef !== undefined && (refs.get(existingRef) ?? 0) > 1
      const needsIndependentRef = key !== '' && (existingRef === undefined || endpointChanged || refIsShared)
      const keyRef = needsIndependentRef
        ? await unusedCredentialRef(deriveRoboModelKeyRef(draft.route), refs)
        : existingRef ?? deriveRoboModelKeyRef(draft.route)
      const keepExistingKey = original !== undefined && existingRef !== undefined && !endpointChanged && key === ''
      const attachBeforeKeyWrite = keepExistingKey || (key !== '' && !needsIndependentRef)
      const existingModels = parseModels(record(resolvedProviders[draft.route])?.models)
      const modelsUnchanged = original !== undefined && JSON.stringify(draft.models) === JSON.stringify(existingModels)
      const profile = {
        displayName: draft.displayName.trim(), api: draft.api, baseURL,
        models: draft.models.map(model => ({ id: model.id.trim(), ...(model.name?.trim() ? { name: model.name.trim() } : {}) })),
        ...(attachBeforeKeyWrite ? { apiKeyEnv: keyRef } : {}),
      }
      // Write only fields this editor owns; redacted headers and advanced model metadata stay on the Host.
      const ops: SettingsPathOpView[] = original === undefined
        ? [{ op: 'set', path: ['providers', draft.route], value: profile as JsonValue }]
        : Object.entries(profile).filter(([field]) => field !== 'models' || !modelsUnchanged)
          .map(([field, value]) => ({ op: 'set', path: ['providers', draft.route, field], value: value as JsonValue }))
      if (original !== undefined && !attachBeforeKeyWrite) ops.push({ op: 'unset', path: ['providers', draft.route, 'apiKeyEnv'] })
      const first = await mutate('llm-pi-ai', ops, openedRevision)
      if (key === '') return
      const stored = await ctx.remote.credentials.set(keyRef, key)
      if (!stored.ok) {
        throw new RoboPartialModelSaveError(`模型服务配置已保存，但 API Key 保存失败：请检查本机凭据存储是否可写`, {
          route: draft.route, displayName: draft.displayName.trim(), baseURL, api: draft.api,
          models: draft.models, credentialConfigured: false,
        }, first.revision)
      }
      if (needsIndependentRef) {
        try {
          await mutate('llm-pi-ai', [{ op: 'set', path: ['providers', draft.route, 'apiKeyEnv'], value: keyRef }], first.revision)
        } catch (error) {
          throw new RoboPartialModelSaveError(`服务地址和 API Key 已保存，但启用密钥失败：请刷新模型列表后重试`, {
            route: draft.route, displayName: draft.displayName.trim(), baseURL, api: draft.api,
            models: draft.models, apiKeyEnv: keyRef, credentialConfigured: true,
          }, first.revision)
        }
      }
    },
    async remove(provider, openedRevision) {
      await mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', provider.route] }], openedRevision)
    },
    async setDefault(provider, model, openedRevision) {
      await mutate('agent-default-model', [
        { op: 'set', path: ['provider'], value: provider },
        { op: 'set', path: ['model'], value: model },
        { op: 'unset', path: ['reasoningEffort'] },
      ], openedRevision)
    },
  }
}

function okEmptyCredentials(): RemoteResult<Record<string, { configured: boolean }>> {
  return { ok: true, value: {} }
}

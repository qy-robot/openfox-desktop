import { useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { RoboCodingAccountSection } from './RoboCodingAccountSection.tsx'
import type { RoboCodingAccountApi } from './robocoding-account-api.ts'
import {
  detectRoboModelProtocol, endpointProtocolHint, ROBO_MODEL_PROTOCOLS,
  RoboPartialModelSaveError,
  type RoboCustomProvider, type RoboModelEntry, type RoboModelsApi, type RoboModelsView,
  type RoboProviderDraft,
} from './robo-models-api.ts'

export interface RoboModelsSectionInjected {
  readonly api: RoboModelsApi
  readonly accountApi: RoboCodingAccountApi
}
export type RoboModelsSectionProps = RoboModelsSectionInjected
const EmbeddedAccountSection = RoboCodingAccountSection as ComponentType<{
  readonly api: RoboCodingAccountApi
  readonly close: () => void
}>

function modelText(models: readonly RoboModelEntry[]): string {
  return models.map(model => model.name === undefined ? model.id : `${model.id} | ${model.name}`).join('\n')
}
function parseModelText(value: string): RoboModelEntry[] {
  const seen = new Set<string>()
  return value.split(/[\n,]/).flatMap(part => {
    const [rawId, rawName] = part.split('|', 2); const id = rawId?.trim() ?? ''
    if (id === '' || seen.has(id)) return []
    seen.add(id); const name = rawName?.trim()
    return [{ id, ...(name ? { name } : {}) }]
  })
}
function blankDraft(): RoboProviderDraft {
  return { route: '', displayName: '', baseURL: '', api: 'openai-completions', models: [], apiKey: '' }
}
function draftOf(provider: RoboCustomProvider): RoboProviderDraft {
  return { route: provider.route, displayName: provider.displayName, baseURL: provider.baseURL, api: provider.api, models: provider.models, apiKey: '' }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

export function RoboModelsSection({ api, accountApi }: RoboModelsSectionProps) {
  const [view, setView] = useState<RoboModelsView>()
  const [loadError, setLoadError] = useState<string>()
  const [editing, setEditing] = useState<RoboCustomProvider | 'new'>()
  const [draft, setDraft] = useState<RoboProviderDraft>(blankDraft)
  const [modelsDraft, setModelsDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [detection, setDetection] = useState<string>()
  const [showOfficialAccount, setShowOfficialAccount] = useState(false)
  const [protocolChoiceRequired, setProtocolChoiceRequired] = useState(false)
  const generation = useRef(0)

  const load = async (): Promise<void> => {
    try { const next = await api.load(); setView(next); setLoadError(undefined) }
    catch (error) { setLoadError(errorText(error)) }
  }
  useEffect(() => { let active = true; void api.load().then(next => { if (active) setView(next) }, error => { if (active) setLoadError(errorText(error)) }); return () => { active = false; generation.current += 1 } }, [api])

  const patch = (next: Partial<RoboProviderDraft>): void => { generation.current += 1; setDetection(undefined); setDraft(current => ({ ...current, ...next })) }
  const beginNew = (): void => { setEditing('new'); setDraft(blankDraft()); setModelsDraft(''); setFormError(undefined); setDetection(undefined); setProtocolChoiceRequired(false) }
  const beginEdit = (provider: RoboCustomProvider): void => { setEditing(provider); setDraft(draftOf(provider)); setModelsDraft(modelText(provider.models)); setFormError(undefined); setDetection(undefined); setProtocolChoiceRequired(false) }
  const closeEditor = (): void => { generation.current += 1; setEditing(undefined); setFormError(undefined); setDetection(undefined) }

  const detect = async (): Promise<void> => {
    const currentGeneration = ++generation.current
    const endpoint = draft.baseURL; const key = draft.apiKey
    setBusy(true); setFormError(undefined); setDetection('正在读取模型列表并判断协议…')
    try {
      const result = await detectRoboModelProtocol(endpoint, protocol => api.discover(endpoint, protocol, key))
      if (currentGeneration !== generation.current) return
      setDetection(result.message)
      if (result.kind === 'failed') return
      setProtocolChoiceRequired(result.kind === 'ambiguous')
      const detectedProtocol = result.candidates[0]
      if (result.kind === 'detected' && detectedProtocol !== undefined) {
        setDraft(current => ({ ...current, api: detectedProtocol }))
      }
      const models = result.models.map(model => ({ id: model.id, ...(model.name ? { name: model.name } : {}) }))
      setModelsDraft(modelText(models)); setDraft(current => ({ ...current, models }))
    } catch (error) { if (currentGeneration === generation.current) setFormError(errorText(error)) }
    finally { if (currentGeneration === generation.current) setBusy(false) }
  }

  const fetchForSelectedProtocol = async (): Promise<void> => {
    const currentGeneration = ++generation.current
    setBusy(true); setFormError(undefined); setDetection(`正在按 ${draft.api} 获取模型…`)
    try {
      const models = await api.discover(draft.baseURL, draft.api, draft.apiKey)
      if (currentGeneration !== generation.current) return
      const rows = models.map(model => ({ id: model.id, ...(model.name ? { name: model.name } : {}) }))
      setModelsDraft(modelText(rows)); setDraft(current => ({ ...current, models: rows })); setDetection(`已按 ${draft.api} 获取 ${String(rows.length)} 个模型`)
    } catch (error) { if (currentGeneration === generation.current) setFormError(errorText(error)) }
    finally { if (currentGeneration === generation.current) setBusy(false) }
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); if (view === undefined || editing === undefined) return
    if (protocolChoiceRequired) { setFormError('请手动确认 Chat Completions、Responses 或 Anthropic Messages 协议'); return }
    setBusy(true); setFormError(undefined)
    try {
      await api.save({ ...draft, models: parseModelText(modelsDraft) }, view.providersRevision, editing === 'new' ? undefined : editing)
      closeEditor(); await load()
    } catch (error) {
      if (error instanceof RoboPartialModelSaveError) {
        setEditing(error.provider)
        setView(current => current === undefined ? current : { ...current, providersRevision: error.revision })
      }
      setFormError(errorText(error))
    }
    finally { setBusy(false) }
  }

  const remove = async (provider: RoboCustomProvider): Promise<void> => {
    if (view === undefined || !window.confirm(`删除“${provider.displayName}”？为避免影响其他配置，已保存的 API Key 会保留在本机凭据存储中。`)) return
    setBusy(true); setLoadError(undefined)
    try { await api.remove(provider, view.providersRevision); await load() }
    catch (error) { setLoadError(errorText(error)) }
    finally { setBusy(false) }
  }

  const chooseDefault = async (provider: string, model: string): Promise<void> => {
    if (view === undefined) return
    setBusy(true); setLoadError(undefined)
    try { await api.setDefault(provider, model, view.defaultRevision); await load() }
    catch (error) { setLoadError(errorText(error)) }
    finally { setBusy(false) }
  }

  if (showOfficialAccount) return <div className="roboModels">
    <button type="button" className="roboModelsButton roboModelsBack" onClick={() => setShowOfficialAccount(false)}>返回模型服务</button>
    <EmbeddedAccountSection api={accountApi} close={() => setShowOfficialAccount(false)} />
  </div>

  return <div className="roboModels">
    <header><h2>模型服务</h2></header>
    <section className="roboModelsCard roboModelsOfficial">
      <div className="roboModelsOfficialHead"><div className="roboModelsOfficialBody"><div className="roboModelsTitleLine"><h3>OpenFox 官方服务</h3></div><p className="roboModelsHint">登录即用，按账户点数结算。</p></div>
        <button type="button" className="roboModelsButton roboModelsButtonPrimary" onClick={() => setShowOfficialAccount(true)}>账户设置</button></div>
      <div className="roboModelsOfficialModels">
        {view?.officialModelsError ? <p role="status" className="roboModelsError">官方模型暂不可用：{view.officialModelsError}</p> : null}
        {view && view.officialModels.length > 0 ? <details className="roboModelsDisclosure" open><summary><span>可用模型 <span className="roboModelsCount">{view.officialModels.length}</span></span></summary><ul className="roboModelsModelList">{view.officialModels.map(model => {
          const selected = view.defaultSelection?.provider === 'robocoding' && view.defaultSelection.model === model.id
          return <li className="roboModelsModel" key={model.id}><span className="roboModelsModelName">{model.name ?? model.id}</span>{selected
            ? <span className="roboModelsDefaultBadge">默认</span>
            : <button type="button" className="roboModelsSetDefault" disabled={busy || !view.writable} aria-label={`${model.name ?? model.id} · 设为默认`} onClick={() => void chooseDefault('robocoding', model.id)}>设为默认</button>}</li>
        })}</ul></details> : null}
      </div>
    </section>
      <div className="roboModelsToolbar"><div className="roboModelsToolbarCopy"><h3>自定义模型</h3><p className="roboModelsHint">API Key 仅保存在本机。</p></div>
      <button type="button" className="roboModelsButton" disabled={busy || view?.writable === false} onClick={beginNew}>添加模型服务</button></div>
    {loadError && <p role="alert" className="roboModelsError">{loadError} <button type="button" className="roboModelsButton" onClick={() => void load()}>重试</button></p>}
    {view === undefined && !loadError ? <p role="status" className="roboModelsHint">正在读取模型设置…</p> : null}
    {view?.writable === false ? <p role="status" className="roboModelsStatus">当前配置为只读，无法添加或修改模型服务。</p> : null}
    {view?.credentialError ? <p role="alert" className="roboModelsError">无法读取 API Key 状态：{view.credentialError}</p> : null}
    {view && view.providers.length === 0 && editing === undefined ? <div className="roboModelsEmpty">尚未添加自定义模型服务。</div> : null}
    {editing !== undefined ? <form className="roboModelsCard roboModelsForm" onSubmit={event => void save(event)}>
      <div className="roboModelsRowHead"><h3>{editing === 'new' ? '添加模型服务' : `编辑 ${editing.displayName}`}</h3><button type="button" className="roboModelsButton" disabled={busy} onClick={closeEditor}>取消</button></div>
      <div className="roboModelsGrid">
        <div className="roboModelsField"><label htmlFor="robo-model-route">服务标识</label><input id="robo-model-route" className="roboModelsInput" value={draft.route} disabled={busy || editing !== 'new'} placeholder="my-gateway" onChange={event => patch({ route: event.currentTarget.value })} /></div>
        <div className="roboModelsField"><label htmlFor="robo-model-name">显示名称</label><input id="robo-model-name" className="roboModelsInput" value={draft.displayName} disabled={busy} placeholder="我的模型服务" onChange={event => patch({ displayName: event.currentTarget.value })} /></div>
        <div className="roboModelsField roboModelsFieldWide"><label htmlFor="robo-model-url">API 地址</label><input id="robo-model-url" type="url" className="roboModelsInput" value={draft.baseURL} disabled={busy} placeholder="https://api.example.com/v1" onChange={event => { const value = event.currentTarget.value; const hint = endpointProtocolHint(value); patch({ baseURL: value, ...(hint ? { api: hint } : {}) }) }} /></div>
        <div className="roboModelsField roboModelsFieldWide"><label htmlFor="robo-model-key">API Key</label><input id="robo-model-key" type="password" autoComplete="off" className="roboModelsInput" value={draft.apiKey} disabled={busy} placeholder={editing !== 'new' && editing.apiKeyEnv ? '留空保留当前密钥' : '填写 API Key'} onChange={event => patch({ apiKey: event.currentTarget.value })} /></div>
      </div>
      <div className="roboModelsField"><label>协议</label><div className="roboModelsProtocol">{ROBO_MODEL_PROTOCOLS.map(value => <label key={value}><input type="radio" name="robo-model-api" value={value} checked={!protocolChoiceRequired && draft.api === value} disabled={busy} onChange={() => { setProtocolChoiceRequired(false); patch({ api: value }) }} />{value}</label>)}</div></div>
      <div className="roboModelsActions"><span className="roboModelsHint">自动检测后请确认协议。</span><button type="button" className="roboModelsButton" disabled={busy || draft.baseURL.trim() === ''} onClick={() => void detect()}>自动判断</button><button type="button" className="roboModelsButton" disabled={busy || draft.baseURL.trim() === ''} onClick={() => void fetchForSelectedProtocol()}>获取模型</button></div>
      {detection && <p role="status" className="roboModelsStatus">{detection}</p>}
      <div className="roboModelsField"><label htmlFor="robo-model-models">模型型号</label><textarea id="robo-model-models" className="roboModelsInput" rows={5} value={modelsDraft} disabled={busy} placeholder={'每行一个，例如：\ngpt-4.1\nmodel-id | 显示名称'} onChange={event => { const value = event.currentTarget.value; generation.current += 1; setModelsDraft(value); setDraft(current => ({ ...current, models: parseModelText(value) })) }} /></div>
      {formError && <p role="alert" className="roboModelsError">{formError}</p>}
      <div className="roboModelsActions"><button type="submit" className="roboModelsButton roboModelsButtonPrimary" disabled={busy || protocolChoiceRequired || view?.writable === false}>{busy ? '处理中…' : '保存模型服务'}</button></div>
    </form> : null}
    <div className="roboModelsList">{view?.providers.map(provider => <section className="roboModelsCard roboModelsProvider" key={provider.route}>
      <div className="roboModelsRowHead"><div><h3>{provider.displayName}</h3><div className="roboModelsMeta"><span>{provider.route}</span><span>{provider.api}</span><span>{provider.credentialConfigured === undefined ? '密钥状态未知' : provider.credentialConfigured ? '密钥已保存' : '未保存密钥'}</span></div></div>
        <div className="roboModelsActions"><button type="button" className="roboModelsButton" disabled={busy || !view.writable} onClick={() => beginEdit(provider)}>编辑</button>
          <button type="button" className="roboModelsButton roboModelsButtonDanger" disabled={busy || !view.writable} onClick={() => void remove(provider)}>删除</button></div></div>
      <p className="roboModelsEndpoint">{provider.baseURL}</p>
      <details className="roboModelsDisclosure"><summary><span>可用模型 <span className="roboModelsCount">{provider.models.length}</span></span><span className="roboModelsDisclosureHint">{view.defaultSelection?.provider === provider.route ? `默认：${provider.models.find(model => model.id === view.defaultSelection?.model)?.name ?? view.defaultSelection.model}` : ''}</span></summary>
      <ul className="roboModelsModelList">{provider.models.map(model => {
        const selected = view.defaultSelection?.provider === provider.route && view.defaultSelection.model === model.id
        const modelName = model.name ?? model.id
        return <li className="roboModelsModel" key={model.id}><span className="roboModelsModelName">{modelName}</span>{selected
          ? <span className="roboModelsDefaultBadge">默认</span>
          : <button type="button" className="roboModelsSetDefault" disabled={busy || !view.writable} aria-label={`${modelName} · 设为默认`} onClick={() => void chooseDefault(provider.route, model.id)}>设为默认</button>}</li>
      })}</ul></details>
    </section>)}</div>

  </div>
}

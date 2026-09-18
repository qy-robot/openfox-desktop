import { Popover } from '@base-ui/react/popover'
import { ChevronDown, Search, Wrench, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { filterRoboSkills, isRoboSkillRunnable, selectionFor, type RoboCatalog, type RoboSkill, type RoboSkillsApi } from './robo-skills-api.ts'
import type { RoboSkillLibrary } from './robo-skills-library.ts'
import type { RoboSkillSession } from './robo-skills-state.ts'
import { roboLocalSkillsApi, type RoboLocalSkill } from './robo-local-skills-api.ts'
import { EMPTY_ROBO_DEVICE_SELECTION, type RoboDeviceSelection } from './robo-device-selection.ts'
import { RoboSkillIcon } from './RoboSkillIcon.tsx'

export interface RoboSkillPickerProps { readonly api: RoboSkillsApi; readonly session: RoboSkillSession; readonly library: RoboSkillLibrary; readonly device?: RoboDeviceSelection; readonly openMarket: () => void; readonly openDevices?: () => void }

function findComposerAnchor(trigger: HTMLElement | null): Element | null {
  let current = trigger?.parentElement ?? null
  while (current) {
    if ([...current.children].some(child => child.matches('[data-input-scroll]'))) return current
    current = current.parentElement
  }
  return trigger
}

export function RoboSkillPicker({ api, session, library, device, openMarket, openDevices }: RoboSkillPickerProps) {
  const devices = device ?? EMPTY_ROBO_DEVICE_SELECTION
  const state = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot, session.store.getSnapshot)
  const installed = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot)
  const currentDevice = useSyncExternalStore(devices.subscribe, devices.getSnapshot, devices.getSnapshot)
  const deviceTriggerLabel = currentDevice.modelId ? (devices.getModelLabel() || currentDevice.modelId.split('/').pop() || '设备') : '设备'
  // The real composer always supplies a device selector. Keeping the optional
  // prop permissive preserves isolated embed/test callers that intentionally
  // provide only the skill menu.
  const deviceReady = device === undefined || Boolean(currentDevice.modelId && currentDevice.profileId)
  // Runs before ConversationSession's passive mirror cleanup. This makes the
  // owned token removal reach the persisted draft when switching to Market.
  useLayoutEffect(() => () => { session.remove() }, [session])
  const [open, setOpen] = useState(false)
  const [localSkills, setLocalSkills] = useState<readonly RoboLocalSkill[]>([])
  const [localError, setLocalError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLocalError('')
    roboLocalSkillsApi.list(controller.signal).then(skills => {
      if (!controller.signal.aborted) setLocalSkills(skills)
    }).catch(() => { if (!controller.signal.aborted) setLocalError('本地技能暂时无法读取，请重新打开菜单。') })
    return () => { controller.abort() }
  }, [open])
  const [catalog, setCatalog] = useState<RoboCatalog>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [modelId, setModelId] = useState(currentDevice.modelId || state.modelId)
  const [profileId, setProfileId] = useState(currentDevice.profileId || state.profileId)
  const [detailId, setDetailId] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError('')
    api.catalog(controller.signal).then(data => { setCatalog(data); try { devices.reconcile(data) } catch { /* Device page provides recovery UI. */ } }).catch(cause => {
      if (!controller.signal.aborted) { setCatalog(undefined); setError(cause instanceof Error ? cause.message : '技能目录加载失败') }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [api, devices, open, reload])
  const skills = useMemo(() => catalog && deviceReady ? filterRoboSkills(catalog, query, device === undefined ? '' : currentDevice.modelId, '').filter(skill => installed.includes(skill.id)) : [], [catalog, query, installed, deviceReady, device, currentDevice.modelId])
  const visibleLocalSkills = useMemo(() => deviceReady ? localSkills.filter(skill => skill.userInvocable !== false && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase())) : [], [deviceReady, localSkills, query])
  const detail = catalog?.skills.find(skill => skill.id === detailId && installed.includes(skill.id))
  const robot = catalog?.robots.find(robot => robot.id === modelId)
  const allowedRobots = detail?.robotIndependent ? [] : catalog?.robots.filter(robot => detail?.targets.some(target => target.modelId === robot.id)) ?? []
  const allowedProfiles = robot?.profiles.filter(profile => !detail || detail.targets.some(target => target.modelId === robot.id && target.profileIds.includes(profile.id))) ?? []
  const selection = detail ? selectionFor(detail, modelId, profileId) : undefined
  function choose(skill: RoboSkill) {
    setError('')
    if (!isRoboSkillRunnable(skill)) { setDetailId(skill.id); return }
    if (skill.robotIndependent) {
      const selection = selectionFor(skill, '', '')!
      if (session.select(skill, selection)) setOpen(false)
      else setError('当前输入正在提交或使用其他指令，请稍后重试')
      return
    }
    setDetailId(skill.id)
    if (!skill.robotIndependent && !skill.targets.some(target => target.modelId === modelId)) { setModelId(''); setProfileId('') }
  }
  function add() {
    if (!detail || !selection) return
    if (!session.select(detail, selection)) { setError('当前输入正在提交或使用其他指令，请稍后重试'); return }
    setOpen(false)
  }
  return <>
    {openDevices && <button type="button" className="roboDeviceTrigger" onClick={openDevices} disabled={state.running} aria-label={currentDevice.modelId ? `切换设备：${deviceTriggerLabel}` : '选择设备'} title={currentDevice.modelId ? `当前设备：${deviceTriggerLabel}` : '选择设备'}>{deviceTriggerLabel}</button>}
    <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) { setDetailId(''); setModelId(currentDevice.modelId || state.modelId); setProfileId(currentDevice.profileId || state.profileId) } }}>
      <Popover.Trigger ref={triggerRef} className="roboSkillTrigger" disabled={state.running || !deviceReady} aria-label="选择技能" title="选择当前设备下的技能">
        <Wrench size={15} aria-hidden="true" /><span>技能</span><ChevronDown size={13} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner anchor={() => findComposerAnchor(triggerRef.current)} side="top" align="start" sideOffset={8} collisionPadding={16} className="roboSkillPositioner">
          <Popover.Popup className="roboSkillPopup" initialFocus={searchRef}>
            <header className="roboSkillHeader"><div><Popover.Title>选择技能</Popover.Title><p>只显示当前设备下的技能</p></div><Popover.Close className="roboSkillIcon" aria-label="关闭技能选择器"><X size={17} /></Popover.Close></header>
            <RoboSkillResult session={session} />
            <label className="roboSkillSearch"><Search size={16} aria-hidden="true" /><input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setDetailId('') }} placeholder="搜索 Skill" aria-label="搜索技能" onKeyDown={event => {
              if (!event.nativeEvent.isComposing && event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('button')?.focus() }
            }} /></label>
            {localError && <p className="roboSkillError" role="alert">{localError}</p>}
            {loading ? <p role="status" className="roboSkillEmpty">正在读取技能目录…</p> : <>
              {!deviceReady ? <div className="roboSkillEmpty" role="status">当前没有可用设备。</div> : <div className="roboSkillList" ref={listRef} aria-label="技能列表" onKeyDown={event => {
                if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
                event.preventDefault(); buttons[next]?.focus()
              }}>
                {visibleLocalSkills.map(skill => <button type="button" key={`local:${skill.name}`} className="roboSkillRow" onClick={() => {
                  if (session.selectLocal(skill.name)) { setOpen(false); setLocalError('') }
                  else setLocalError('请先结束当前命令，再选择本地技能。')
                }}><span className="roboSkillRowIcon"><RoboSkillIcon label={skill.name} /></span><span className="roboSkillRowCopy"><span className="roboSkillRowTitle"><strong>{skill.name}</strong><small>本地</small></span><span className="roboSkillRowDescription">{skill.description}</span></span></button>)}
                {skills.map(skill => <button type="button" key={skill.id} className="roboSkillRow" data-selected={detailId === skill.id} aria-pressed={detailId === skill.id} onClick={() => { choose(skill) }}>
                  <span className="roboSkillRowIcon"><RoboSkillIcon icon={skill.icon} label={skill.displayName} /></span><span className="roboSkillRowCopy"><span className="roboSkillRowTitle"><strong>{skill.displayName}</strong><small>{!skill.demo ? (isRoboSkillRunnable(skill) ? '本地只读' : '目录展示') : skill.robotIndependent ? '通用' : `${skill.targets.length} 个型号`}</small></span>
                  <span className="roboSkillRowDescription">{skill.summary}</span></span>
                </button>)}
                {!skills.length && !visibleLocalSkills.length && !error && <div className="roboSkillEmpty">{query ? '没有匹配的技能' : catalog?.skills.some(skill => installed.includes(skill.id)) ? '没有匹配的技能' : installed.length ? '已添加的技能暂不可用，请刷新或去技能市场添加其他技能。' : localSkills.length ? '还没有添加市场技能。' : '还没有添加技能，去技能市场看看。'}{query && <button type="button" onClick={() => { setQuery('') }}>清除搜索</button>}</div>}
              </div>}
              {detail && <section className="roboSkillDetail" aria-label="当前设备的技能详情">
                {!isRoboSkillRunnable(detail) ? <><p>此技能已在目录上架，执行引擎尚未开放。你可以保留在“我的技能”中，开放后再使用。</p><button type="button" className="roboSkillPrimary" disabled>暂不可运行</button></> : <>
                {!detail.robotIndependent && !device && <div className="roboSkillFilters">
                  <label>设备型号<select aria-label="技能设备型号" value={modelId} onChange={event => { setModelId(event.target.value); setProfileId('') }}>
                    <option value="">请选择型号</option>{allowedRobots.map(robot => <option key={robot.id} value={robot.id}>{robot.displayName}</option>)}
                  </select></label>
                  <label>开发方式<select aria-label="技能开发方式" value={profileId} onChange={event => { setProfileId(event.target.value) }}>
                    <option value="">请选择开发方式</option>{allowedProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                  </select></label>
                </div>}
                <p>{detail.id === 'bumi-sdk-development' ? '选择后填写 SDK、DDS 或报错文本；点击输入框旁的“运行技能”才做本地只读预检，普通发送仍走 AI。' : '选择后填写日志并点击“运行技能”，普通发送仍走 AI。'}</p>
                <button type="button" className="roboSkillPrimary" disabled={!selection || state.running} onClick={add}>使用此技能</button>
                </>}
              </section>}
            </>}
            {error && <p className="roboSkillError" role="alert">{error}</p>}
            <footer className="roboSkillFooter"><button type="button" onClick={() => { setOpen(false); openMarket() }}>打开技能市场</button>{openDevices && <button type="button" onClick={() => { setOpen(false); openDevices() }}>选择设备</button>}<button type="button" disabled={loading || !deviceReady} onClick={() => { setReload(value => value + 1) }}>刷新</button></footer>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
    {state.selection && <span className="roboSkillChip"><span title={state.skill?.displayName}>{state.skill?.displayName}</span><button type="button" disabled={state.running} aria-label="运行技能" onClick={() => { session.run() }}>运行</button><button type="button" disabled={state.running} aria-label="移除技能" onClick={() => { session.remove() }}><X size={13} /></button></span>}
  </>
}

export function RoboSkillResult({ session }: { readonly session: RoboSkillSession }) {
  const state = useSyncExternalStore(session.store.subscribe, session.store.getSnapshot, session.store.getSnapshot)
  if (!state.selection && !state.running && !state.result && !state.error) return null
  return <section className="roboSkillResult" aria-label="本地技能状态" aria-live="polite">
    {state.selection && <p>本地示例：{state.skill?.displayName}。发送后仅将输入文字交给本地技能服务；不支持附件。</p>}
    {state.running && <p role="status">正在运行本地安全分析…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.result && <><div className="roboSkillRowTitle"><strong>{state.result.summary}</strong><button type="button" onClick={() => { session.dismissResult() }} aria-label="关闭技能结果"><X size={14} /></button></div>
      {state.result.bumi && <p><strong>状态：</strong>{state.result.bumi.status}。以下内容全部是待审核提案，未执行。</p>}
      <ul>{state.result.findings.map((finding, index) => <li key={index}><span>{finding.level === 'warning' ? '注意' : '信息'}：</span>{finding.message}</li>)}</ul>
      {state.result.bumi && <>
        {!!state.result.bumi.filePatchProposals.length && <div><strong>文件修改提案</strong><ul>{state.result.bumi.filePatchProposals.map((item, index) => <li key={index}><code>{item.targetPath}</code>：{item.changeSummary}（需审批）</li>)}</ul></div>}
        {!!state.result.bumi.commandProposals.length && <div><strong>命令提案</strong><ul>{state.result.bumi.commandProposals.map((item, index) => <li key={index}><code>{item.command}</code>：{item.purpose}（需审批，未执行）</li>)}</ul></div>}
        {!!state.result.bumi.deviceOperationProposals.length && <div><strong>设备操作提案</strong><ul>{state.result.bumi.deviceOperationProposals.map((item, index) => <li key={index}>{item.operation}：{item.purpose}（需审批，未连接设备）</li>)}</ul></div>}
        <div><strong>安全说明</strong><ul>{state.result.bumi.safetyNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>
      </>}
      <small>{state.result.bumi ? 'Bumi 本地结构化结果 · 未调用模型、未执行命令、未修改文件、未连接设备' : '本地示例结果 · 未调用模型或实体设备'}</small></>}
  </section>
}

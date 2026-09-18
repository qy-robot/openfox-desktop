import { Bot, Check, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { RoboDeviceSelection } from './robo-device-selection.ts'
import type { RoboCatalog, RoboSkillsApi } from './robo-skills-api.ts'

export interface RoboDeviceWorkbenchProps {
  readonly api: RoboSkillsApi
  readonly selection: RoboDeviceSelection
  readonly close: () => void
  readonly openMarket: () => void
}

export function RoboDeviceWorkbench({ api, selection, openMarket }: RoboDeviceWorkbenchProps) {
  const current = useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot)
  const [catalog, setCatalog] = useState<RoboCatalog>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [category, setCategory] = useState<'robot' | 'arm'>('robot')
  const categoryLabel = category === 'arm' ? '机械臂' : '设备'
  const selectableRobots = useMemo(() => catalog?.robots.filter(robot => !robot.id.startsWith('example-robotics/')) ?? [], [catalog])
  const categoryRobots = useMemo(() => selectableRobots.filter(robot =>
    /机械臂|robotic[ _-]?arm|manipulator|^arm$/iu.test(robot.family) === (category === 'arm')), [selectableRobots, category])
  const [family, setFamily] = useState('')
  const families = useMemo(() => [...new Set(categoryRobots.map(robot => robot.family).filter(Boolean))], [categoryRobots])
  const activeFamily = families.includes(family) ? family : ''
  const modelName = (robot: { readonly model?: string; readonly displayName: string }) => robot.model || robot.displayName
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [detailId, setDetailId] = useState('')
  const [profileChoice, setProfileChoice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setNotice('')
    api.devices(controller.signal).then(data => {
      if (controller.signal.aborted) return
      setCatalog(data)
      try {
        if (selection.reconcile(data)) setNotice('原先选择的型号已不在目录中，已清除本机记录。')
      } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '过期设备记录清理失败') }
    }).catch(cause => {
      if (!controller.signal.aborted) { setCatalog(undefined); setError(cause instanceof Error ? cause.message : '设备目录加载失败') }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [api, reload, selection])
  const robots = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    return categoryRobots.filter(robot => (!activeFamily || robot.family === activeFamily) && terms.every(term => [robot.id, robot.displayName, robot.model, robot.manufacturer,
      robot.family, ...robot.profiles.map(profile => profile.label)].join(' ').toLocaleLowerCase().includes(term))) ?? []
  }, [categoryRobots, query, activeFamily])
  const detail = detailId ? categoryRobots.find(robot => (!activeFamily || robot.family === activeFamily) && robot.id === detailId) : undefined
  const detailDescription = detail?.description || (detail?.id === 'unitree/g1'
    ? '宇树 G1 人形机器人公开开发档案；具体硬件批次、固件和网络参数以现场设备资料为准。'
    : detail?.id === 'noetix/bumi' ? '布米人形机器人公开开发档案；版本和硬件配置以项目资料为准。' : '暂无设备介绍，后续可在工作台补充。')
  const detailProfileId = detail ? (profileChoice || (current.modelId === detail.id ? current.profileId : '') || detail.profiles[0]?.id || '') : ''
  const currentDeviceRecord = catalog?.robots.find(robot => robot.id === current.modelId)
  const currentProfileLabel = currentDeviceRecord?.profiles.find(profile => profile.id === current.profileId)?.label
  function choose(modelId: string, requestedProfileId?: string, closeDetails = false) {
    const robot = catalog?.robots.find(item => item.id === modelId)
    const profileId = requestedProfileId || robot?.profiles[0]?.id || ''
    setSaveError(''); setNotice('')
    try {
      selection.select(modelId, profileId, robot?.displayName ?? modelName(robot ?? { displayName: modelId }))
      setDetailId(closeDetails ? '' : modelId)
      setProfileChoice('')
      setNotice(`已选择「${robot?.manufacturer ?? ''} ${modelName(robot ?? { displayName: modelId })} · ${robot?.profiles.find(profile => profile.id === profileId)?.label ?? '版本'}」。技能会按这个设备型号进行匹配。`)
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '设备型号保存失败') }
  }
  const closeDetails = () => { setDetailId(''); setProfileChoice('') }
  useEffect(() => {
    if (!detailId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailId('')
        setProfileChoice('')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [detailId])
  return <section className="roboMarket roboDevices" aria-label="设备"><div className="roboMarketInner">
    <header className="roboDeviceHeader">
      <div className="roboDeviceTabs" role="tablist" aria-label="设备类型">
        {(['robot', 'arm'] as const).map((value, index) => <button key={value} id={`device-tab-${value}`} type="button" role="tab" aria-selected={category === value} aria-controls="device-panel" tabIndex={category === value ? 0 : -1}
          onClick={() => { setCategory(value); setFamily(''); setDetailId(''); setProfileChoice(''); setQuery(''); setNotice('') }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'robot' : event.key === 'End' ? 'arm' : index === 0 ? 'arm' : 'robot'
            setCategory(next); setFamily(''); setDetailId(''); setProfileChoice(''); setQuery(''); setNotice('')
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#device-tab-${next}`)?.focus()
          }}>{value === 'robot' ? '设备' : '机械臂'}</button>)}
      </div>
      <div className="roboDeviceHeaderTools"><label className="roboSkillSearch"><Search size={17} /><input aria-label={`搜索${categoryLabel}型号`} placeholder="搜索型号、厂商或系列…" value={query} onChange={event => { setQuery(event.target.value) }} /></label><div className="roboDeviceHeadingActions"><button type="button" className="roboMarketBack" onClick={openMarket}>适用技能</button><button type="button" className="roboMarketBack" disabled={loading} onClick={() => { setReload(value => value + 1) }}>刷新</button></div></div>
    </header>
    <div id="device-panel" role="tabpanel" aria-labelledby={`device-tab-${category}`}>
    <div className="roboDeviceFamilies" role="tablist" aria-label="型号分类">
      {['', ...families].map((value, index) => <button key={value} id={`device-family-${index}`} type="button" role="tab" aria-selected={activeFamily === value} aria-controls="device-family-panel" tabIndex={activeFamily === value ? 0 : -1}
        onClick={() => { setFamily(value); setDetailId(''); setProfileChoice('') }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const values = ['', ...families]
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length
          setFamily(values[next] ?? ''); setDetailId(''); setProfileChoice('')
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#device-family-${next}`)?.focus()
        }}>{value || '全部'}</button>)}
    </div>
    <div id="device-family-panel" role="tabpanel" aria-labelledby={`device-family-${['', ...families].indexOf(activeFamily)}`}>
    {error && <div className="roboMarketFeedback" role="alert">{error}<button type="button" disabled={loading} onClick={() => { setReload(value => value + 1) }}>重试</button></div>}
    {saveError && <p className="roboMarketFeedback" role="alert">{saveError}</p>}
    {notice && <div className="roboMarketFeedback" role="status"><Check size={16} /><span>{notice}</span></div>}
    {detail && <div className="roboMarketModalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDetails() }}>
      <section className="roboMarketModal roboDeviceDetails" role="dialog" aria-modal="true" aria-labelledby="robo-device-detail-title">
      <button type="button" className="roboMarketModalClose" aria-label="关闭设备详情" onClick={closeDetails}><X size={18} aria-hidden="true" /></button>
      <div className="roboDeviceDetails__grid">
        <div className="roboDeviceDetails__media">{detail.image ? <img src={detail.image} alt={`${detail.displayName}图片`} /> : <Bot size={54} strokeWidth={1.5} aria-label="机器人头像" />}</div>
        <div className="roboDeviceDetails__content">
          <header><div><p className="roboMarketEyebrow">{detail.manufacturer}</p><h2 id="robo-device-detail-title">{modelName(detail)}</h2><p className="roboMarketNote">{detail.displayName}</p></div><button type="button" className="roboMarketLink" onClick={() => { choose(detail.id, detailProfileId, true) }}>使用此型号</button></header>
          <dl className="roboDeviceDetails__facts"><div><dt>厂商</dt><dd>{detail.manufacturer}</dd></div><div><dt>型号</dt><dd>{modelName(detail)}</dd></div><div><dt>版本</dt><dd>{detail.profiles.find(profile => profile.id === detailProfileId)?.label ?? '版本'}</dd></div></dl>
          <label className="roboDeviceProfileChoice"><span>选择版本</span><select aria-label={`${detail.displayName}版本`} value={detailProfileId} onChange={event => { setProfileChoice(event.target.value) }}>{detail.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
          <section className="roboDeviceDetails__description"><h3>设备详情</h3><p>{detailDescription}</p></section>
        </div>
      </div>
      </section></div>}
    {loading ? <p className="roboSkillEmpty" role="status">正在加载设备目录…</p> : <>
      <p className="roboMarketCount">{robots.length} 个{categoryLabel}型号{current.modelId ? ` · 当前型号 · ${currentProfileLabel ?? current.profileId}` : ''}</p>
      <div className="roboMarketCards roboDeviceCards">{robots.map(robot => {
        const selected = current.modelId === robot.id
        const profileId = (selected ? current.profileId : '') || robot.profiles[0]?.id || ''
        return <article key={robot.id} className="roboMarketCard roboDeviceCard" data-current={selected || undefined} role="button" tabIndex={0} aria-label={`查看${robot.displayName}详情`} onClick={event => { if (!(event.target as HTMLElement).closest('button,select')) { setDetailId(robot.id); setProfileChoice('') } }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setDetailId(robot.id); setProfileChoice('') } }}>
          <div className="roboDeviceCard__image">{robot.image ? <img src={robot.image} alt={`${robot.displayName}图片`} /> : <Bot size={34} strokeWidth={1.5} aria-label="机器人头像" />}</div>
          <div className="roboDeviceCard__body"><div className="roboDeviceCard__meta"><span className="roboMarketEyebrow">{robot.manufacturer}</span><span className="roboDeviceVersion">{robot.profiles.find(profile => profile.id === profileId)?.label ?? '版本'}</span></div><h2><button type="button" className="roboMarketLink" aria-label={`查看${robot.displayName}详情`} onClick={() => { setDetailId(robot.id); setProfileChoice('') }}>{modelName(robot)}</button></h2>
          <footer><button type="button" className={selected && profileId === current.profileId ? 'roboMarketAdded' : 'roboMarketAdd'} onClick={() => { choose(robot.id) }}>{selected && profileId === current.profileId ? <><Check size={15} />当前选择</> : '使用此型号'}</button></footer></div>
        </article>
      })}</div>
      {!robots.length && !error && <div className="roboMarketEmpty"><Bot size={30} /><h2>{categoryRobots.length ? '没有找到匹配的型号' :  `暂无${categoryLabel}型号`}</h2><p>{categoryRobots.length ? '试试其他型号、厂商或系列关键词。' : `发布${categoryLabel}型号后，可在这里刷新并选择。`}</p>{query ? <button type="button" className="roboMarketAdd" onClick={() => { setQuery('') }}>清除搜索</button> : <button type="button" className="roboMarketAdd" onClick={() => { setReload(value => value + 1) }}>重新加载</button>}</div>}
    </>}
  </div></div></div></section>
}

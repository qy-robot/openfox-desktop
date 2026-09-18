import { Bot, Check, ChevronDown, CircleDot, Code2, Plus, Search, Store, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { filterRoboSkills, type RoboCatalog, type RoboSkill, type RoboSkillsApi } from './robo-skills-api.ts'
import type { RoboSkillLibrary } from './robo-skills-library.ts'
import { RoboLocalSkills } from './RoboLocalSkills.tsx'
import type { RoboLocalSkillsApi } from './robo-local-skills-api.ts'
import { EMPTY_ROBO_DEVICE_SELECTION, type RoboDeviceSelection } from './robo-device-selection.ts'
import { RoboSkillIcon } from './RoboSkillIcon.tsx'

export interface RoboSkillMarketProps {
  readonly localApi?: RoboLocalSkillsApi
  readonly api: RoboSkillsApi
  readonly library: RoboSkillLibrary
  readonly device?: RoboDeviceSelection
  readonly close: () => void
}

const MARKET_ICONS: readonly ReactNode[] = [<CircleDot key="inspect" />, <Code2 key="code" />, <Bot key="robot" />, <Wrench key="tool" />]

function categoryLimit(width: number): number {
  if (width >= 1280) return 8
  if (width >= 980) return 6
  if (width >= 720) return 4
  return 2
}

export function RoboSkillMarket({ api, library, device, localApi }: RoboSkillMarketProps) {
  const devices = device ?? EMPTY_ROBO_DEVICE_SELECTION
  const installed = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot)
  const currentDevice = useSyncExternalStore(devices.subscribe, devices.getSnapshot, devices.getSnapshot)
  const [catalog, setCatalog] = useState<RoboCatalog>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('featured')
  const [modelId, setModelId] = useState(currentDevice.modelId)
  const [mine, setMine] = useState(false)
  const [addLocal, setAddLocal] = useState(false)
  const [localCount, setLocalCount] = useState(0)
  const [detailId, setDetailId] = useState('')
  const [maxVisibleCategories, setMaxVisibleCategories] = useState(() => categoryLimit(typeof window === 'undefined' ? 1280 : window.innerWidth))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const lastDetail = useRef('')
  const hasCatalog = useRef(false)
  const lastDeviceModelId = useRef(currentDevice.modelId)

  useEffect(() => {
    const controller = new AbortController()
    if (!hasCatalog.current) setLoading(true)
    setError('')
    api.catalog(controller.signal).then(data => { if (!controller.signal.aborted) {
      const firstLoad = !hasCatalog.current
      hasCatalog.current = true
      setCatalog(data)
      setCategory(value => firstLoad && value === 'featured' && !data.featuredSkillIds.length ? 'all'
        : value === 'featured' || value === 'all'
        || data.categories.some(item => item.id === value && item.visible) ? value : 'all')
      setModelId(value => !value || data.robots.some(robot => robot.id === value) ? value : '')
      try { if (devices.reconcile(data)) setModelId('') } catch { /* The device page reports persistence errors. */ }
    } }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '技能市场加载失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [api, devices, reload])
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') setReload(value => value + 1) }
    const onResize = () => { setMaxVisibleCategories(categoryLimit(window.innerWidth)) }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('resize', onResize)
    const interval = window.setInterval(refreshWhenVisible, 60_000)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('resize', onResize)
      window.clearInterval(interval)
    }
  }, [])
  useEffect(() => {
    if (lastDeviceModelId.current === currentDevice.modelId) return
    lastDeviceModelId.current = currentDevice.modelId
    if (!currentDevice.modelId || catalog?.robots.some(robot => robot.id === currentDevice.modelId)) setModelId(currentDevice.modelId)
  }, [catalog, currentDevice.modelId])
  useEffect(() => {
    if (detailId) { headingRef.current?.focus(); lastDetail.current = detailId }
    else if (lastDetail.current) {
      const card = [...(cardsRef.current?.querySelectorAll<HTMLButtonElement>('[data-skill-detail]') ?? [])]
        .find(button => button.dataset.skillDetail === lastDetail.current)
      card?.focus()
    }
  }, [detailId])
  useEffect(() => {
    if (!detailId) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailId('') }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [detailId])

  const skills = useMemo(() => {
    if (!catalog) return []
    if (mine) return catalog.skills.filter(skill => installed.includes(skill.id))
    const filtered = filterRoboSkills(catalog, query, modelId,
      category === 'featured' || category === 'all' ? '' : category)
    if (category !== 'featured') return filtered
    const order = new Map(catalog.featuredSkillIds.map((id, index) => [id, index]))
    return filtered.filter(skill => order.has(skill.id))
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
  }, [catalog, query, modelId, category, mine, installed])
  const groups = useMemo(() => category === 'featured' ? (skills.length ? [{ id: 'featured', name: '精选', visible: true, skills }] : [])
    : (catalog?.categories ?? []).map(item => ({
    ...item,
    skills: skills.filter(skill => skill.category === item.id),
  })).filter(group => group.skills.length > 0), [catalog, category, skills])
  const availableInstalled = catalog?.skills.filter(skill => installed.includes(skill.id)).length ?? 0
  const detail = catalog?.skills.find(skill => skill.id === detailId)
  const categoryTabs = useMemo(() => (catalog?.categories ?? [])
    .filter(item => item.visible && catalog?.skills.some(skill => skill.category === item.id)), [catalog])
  const primaryCategories = categoryTabs.slice(0, maxVisibleCategories)
  const overflowCategories = categoryTabs.slice(maxVisibleCategories)

  async function toggle(skill: RoboSkill) {
    if (saving) return
    setSaving(true); setSaveError('')
    try {
      const wasAdded = installed.includes(skill.id)
      if (wasAdded) await library.remove(skill.id)
      else await library.add(skill.id)
      setNotice(wasAdded ? `已移除「${skill.displayName}」` : `已添加「${skill.displayName}」，可在输入框的技能菜单中选择`)
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '未能保存技能，请重试'); setNotice('') } finally { setSaving(false) }
  }
  function resetFilters() { setQuery(''); setCategory('all'); setModelId(''); setMine(false) }
  function toggleManage() {
    if (!mine) { setQuery(''); setCategory('all'); setModelId('') }
    setMine(value => !value)
  }
  const categoryName = (skill: RoboSkill) => catalog?.categories.find(item => item.id === skill.category)?.name ?? skill.category
  const publisherKindName = (skill: RoboSkill) => skill.publisher?.kind === 'company' ? '擎云官方' : '社区技能'
  const nonEmptyText = (value: string | undefined | null): value is string => Boolean(value?.trim())
  const nonEmptyTexts = (values: readonly string[] | undefined) => (values ?? []).filter(nonEmptyText)
  const robotNames = (skill: RoboSkill) => skill.robotIndependent ? '通用 · 无需设备' : catalog?.robots
    .filter(robot => skill.targets.some(target => target.modelId === robot.id)).map(robot => `${robot.manufacturer} ${robot.model ?? robot.displayName}`).join('、')
  const addButton = (skill: RoboSkill, compact = false) => <button type="button" className={installed.includes(skill.id) ? 'roboMarketAdded' : 'roboMarketAdd'}
    aria-label={`${installed.includes(skill.id) ? '移除' : '添加'}${skill.displayName}`} disabled={loading || saving} onClick={() => { void toggle(skill) }}>
    {!compact && (installed.includes(skill.id) ? <Check size={15} /> : <Plus size={15} />)}{installed.includes(skill.id) ? '已添加' : '添加'}
  </button>

  return <section className="roboMarket" aria-label="技能市场">
    <div className="roboMarketInner">
      <header className="roboMarketTop"><nav className="roboMarketPrimaryTabs" aria-label="市场类型"><button type="button" aria-current="page">技能</button></nav>
        <div className="roboMarketTopActions"><label className="roboSkillSearch"><Search size={17} /><input aria-label="搜索技能市场" placeholder="搜索技能" value={query} onChange={event => { setQuery(event.target.value) }} /></label>
          <button type="button" className="roboMarketMine" aria-pressed={mine} onClick={toggleManage}><Wrench size={16} />管理 <span>{availableInstalled + localCount}</span></button>
          <button type="button" className="roboMarketCreate" aria-label="添加本地技能" onClick={() => { setAddLocal(true) }}><Plus size={16} />添加</button></div></header>
      {error && <div className="roboMarketFeedback" role="alert">{error}<button type="button" disabled={loading} onClick={() => { setReload(value => value + 1) }}>重试</button></div>}
      <RoboLocalSkills open={addLocal} manage={mine} onClose={() => { setAddLocal(false) }} onAdded={() => { setMine(true) }} onCount={setLocalCount} api={localApi} />
      {saveError && <p className="roboMarketFeedback" role="alert">{saveError} 请再次点击技能的添加或移除按钮。</p>}
      {notice && <div className="roboMarketFeedback" role="status"><Check size={16} /><span>{notice}</span><button type="button" aria-label="关闭技能市场提示" onClick={() => { setNotice('') }}><X size={16} /></button></div>}
      <div className="roboMarketFilters"><nav className="roboMarketCategories" aria-label="技能分类"><button type="button" aria-pressed={category === 'featured'} onClick={() => { setCategory('featured') }}>精选</button><button type="button" aria-pressed={category === 'all'} onClick={() => { setCategory('all') }}>全部</button>{primaryCategories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id) }}>{item.name}</button>)}{overflowCategories.length > 0 && <details className="roboMarketMore"><summary><span>更多</span><ChevronDown size={14} /></summary><div>{overflowCategories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id) }}>{item.name}</button>)}</div></details>}</nav>
        <label className="roboMarketRobot"><span>设备</span><select aria-label="市场设备筛选" value={modelId} onChange={event => { setModelId(event.target.value) }}><option value="">全部型号</option>{catalog?.robots.map(robot => <option key={robot.id} value={robot.id}>{robot.manufacturer} {robot.model ?? robot.displayName}</option>)}</select></label></div>
      {loading ? <p className="roboSkillEmpty" role="status">正在加载技能市场…</p> : <>
        <p className="roboMarketCount">{skills.length} 个技能{mine ? ' · 已添加到本机' : ''}</p>
        <div className="roboMarketGroups" ref={cardsRef}>{groups.map((group, groupIndex) => <section key={group.id} className="roboMarketGroup"><h2>{group.name}</h2>
          <div className="roboMarketCards">{group.skills.map((skill, index) => <article key={skill.id} className="roboMarketCard" data-skill-card={skill.id} role="button" tabIndex={0} aria-label={`查看${skill.displayName}详情`} onClick={event => {
            if ((event.target as HTMLElement).closest('button')) return
            setDetailId(skill.id)
          }} onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            setDetailId(skill.id)
          }}>
            <header className="roboMarketCardHeader"><button type="button" className={`roboMarketIcon roboMarketIcon${(groupIndex + index) % 4}`} data-skill-detail={skill.id} aria-label={`查看${skill.displayName}详情`} onClick={() => { setDetailId(skill.id) }}><RoboSkillIcon icon={skill.icon} label={skill.displayName} fallback={MARKET_ICONS[(groupIndex + index) % MARKET_ICONS.length]} /></button><div className="roboMarketCardKicker"><span>技能</span><span>{categoryName(skill)}</span></div><div className="roboMarketCardAction">{addButton(skill, true)}</div></header>
            <div className="roboMarketCardCopy"><span className="roboMarketCardLabel">卡片摘要</span><h3><button type="button" onClick={() => { setDetailId(skill.id) }}>{skill.displayName}</button></h3><p>{skill.summary}</p></div>
            <footer className="roboMarketCardFooter"><span className="roboMarketScope">{robotNames(skill)}</span><span className="roboMarketCardOpen">查看详情 <span aria-hidden="true">→</span></span></footer>
          </article>)}</div></section>)}</div>
        {!skills.length && !error && <div className="roboMarketEmpty"><Store size={30} /><h2>{mine && !availableInstalled ? (installed.length ? '已添加的技能暂不可用' : '还没有添加市场技能') : category === 'featured' ? '暂无精选技能' : '没有找到匹配的技能'}</h2><p>{mine && !availableInstalled ? '在技能目录中查看介绍，把需要的技能加入自己的列表。' : category === 'featured' ? '精选内容由工作台发布，你仍可浏览全部技能。' : '试试其他关键词、分类或设备型号。'}</p><button type="button" className="roboMarketAdd" onClick={resetFilters}>浏览全部技能</button></div>}
      </>}
      <p className="roboMarketNote">市场技能只展示公开介绍，技能实现保留在服务端；自己添加的本地技能仅保存在本机。</p>
    </div>
    {detail && <div className="roboMarketModalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailId('') }}>
      <article className="roboMarketModal" role="dialog" aria-modal="true" aria-labelledby="robo-market-detail-title">
        <button type="button" className="roboMarketModalClose" aria-label="关闭技能详情" onClick={() => { setDetailId('') }}><X size={20} /></button>
        <header className="roboMarketDetailHeading"><span className="roboMarketIcon roboMarketIcon0"><RoboSkillIcon icon={detail.icon} label={detail.displayName} fallback={MARKET_ICONS[0]} /></span><div><span className="roboMarketEyebrow">{categoryName(detail)} · v{detail.version}</span><h1 id="robo-market-detail-title" ref={headingRef} tabIndex={-1}>{detail.displayName}</h1>{nonEmptyText(detail.summary) && <p>{detail.summary}</p>}</div></header>
        <div className="roboMarketModalBody">
        {detail.publisher && <div className="roboMarketPublisher"><span className="roboMarketPublisherIcon"><Store size={17} /></span><div className="roboMarketPublisherCopy"><span className="roboMarketPublisherLabel">发布者</span><strong>{nonEmptyText(detail.publisher.displayName) ? detail.publisher.displayName : publisherKindName(detail)}</strong><div className="roboMarketPublisherMeta"><span>{publisherKindName(detail)}</span>{nonEmptyTexts(detail.publisher.labels).map(label => <span key={label}>{label}</span>)}</div></div></div>}
        <div className="roboMarketDetailGrid"><div className="roboMarketDetailMain">
          {nonEmptyText(detail.details?.overview) && <section><h2>详情简介</h2><p>{detail.details?.overview}</p></section>}
          {nonEmptyTexts(detail.details?.inputs).length > 0 && <section><h2>需要提供</h2><ul>{nonEmptyTexts(detail.details?.inputs).map(text => <li key={text}>{text}</li>)}</ul></section>}
          {nonEmptyTexts(detail.details?.outputs).length > 0 && <section><h2>输出内容</h2><ul>{nonEmptyTexts(detail.details?.outputs).map(text => <li key={text}>{text}</li>)}</ul></section>}
          {nonEmptyTexts(detail.details?.limitations).length > 0 && <section><h2>能力与限制</h2><ul>{nonEmptyTexts(detail.details?.limitations).map(text => <li key={text}>{text}</li>)}</ul></section>}
        </div><aside className="roboMarketDetailAside">{nonEmptyText(robotNames(detail)) && <section><h2>适用范围</h2><p>{robotNames(detail)}</p></section>}<section><h2>技能信息</h2><dl><div><dt>版本</dt><dd>{detail.version}</dd></div></dl></section></aside></div>
        </div>
        <footer className="roboMarketModalFooter">{addButton(detail)}</footer>
      </article>
    </div>}
  </section>
}

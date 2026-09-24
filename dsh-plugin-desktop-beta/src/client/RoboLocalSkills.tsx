import { FolderOpen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { roboLocalSkillsApi, type RoboLocalSkill, type RoboLocalSkillsApi } from './robo-local-skills-api.ts'

export function RoboLocalSkills({ open, manage, onClose, onAdded, onCount, api = roboLocalSkillsApi }: {
  readonly open: boolean; readonly manage: boolean; readonly onClose: () => void
  readonly onAdded: () => void; readonly onCount: (count: number) => void; readonly api?: RoboLocalSkillsApi | undefined
}) {
  const [skills, setSkills] = useState<readonly RoboLocalSkill[]>([])
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [removing, setRemoving] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const picker = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setListError('')
    api.list(controller.signal).then(value => {
      if (!controller.signal.aborted) { setSkills(value); onCount(value.length) }
    }).catch(cause => {
      if (!controller.signal.aborted) setListError(cause instanceof Error ? cause.message : '无法读取本地技能。')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [api, reload, manage, onCount])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    setError(''); setDirectory('')
    dialog.current?.showModal()
    picker.current?.focus()
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [open])
  async function pick() {
    setBusy(true); setError('')
    try { const path = await api.pick(); if (path !== null) setDirectory(path) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开文件夹选择器，请填写本地路径。') }
    finally { setBusy(false) }
  }
  async function add() {
    if (busy || !directory.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const skill = await api.import(directory.trim())
      setNotice(skill.userInvocable === false ? `已添加本地技能「${skill.name}」，该技能不支持手动调用。` : `已添加本地技能「${skill.name}」，可在会话技能菜单中选择，或输入 /${skill.name} 使用。`)
      setReload(value => value + 1); onAdded(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '添加失败，请检查技能文件夹。') }
    finally { setBusy(false) }
  }
  async function remove(name: string) {
    setBusy(true); setListError(''); setNotice('')
    try { await api.remove(name); setRemoving(''); setReload(value => value + 1); setNotice(`已移除本地技能「${name}」，原始文件夹保留。`) }
    catch (cause) { setListError(cause instanceof Error ? cause.message : '移除失败，请重试。') }
    finally { setBusy(false) }
  }
  return <>
    {notice && <p className="roboMarketFeedback" role="status">{notice}</p>}
    {manage && <section className="roboLocalSkills" aria-label="本地技能">
      <h2>本地技能 <span>{skills.length}</span></h2>
      {listError && <p role="alert">{listError} <button type="button" onClick={() => { setReload(value => value + 1) }}>重试</button></p>}
      {loading ? <p role="status">正在读取本地技能…</p> : !skills.length && !listError ? <p>还没有本地技能，点击右上角“添加”选择技能文件夹。</p> : null}
      {skills.map(skill => <article key={skill.name} className="roboLocalSkillRow">
        <div><h3>{skill.name}</h3><p>{skill.description}</p><small>{skill.userInvocable === false ? '不支持手动调用' : `在会话中输入 /${skill.name}`}</small></div>
        {removing === skill.name ? <div className="roboLocalSkillRemove"><span>移除本机副本？</span><button type="button" disabled={busy} onClick={() => { void remove(skill.name) }}>确认移除</button><button type="button" disabled={busy} onClick={() => { setRemoving('') }}>取消</button></div>
          : <button type="button" className="roboMarketAdded" disabled={busy} onClick={() => { setRemoving(skill.name) }}>移除</button>}
      </article>)}
    </section>}
    {open && <dialog ref={dialog} className="roboLocalSkillDialog" aria-labelledby="robo-local-skill-title" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
      <button type="button" className="roboMarketModalClose" aria-label="关闭添加本地技能" disabled={busy} onClick={onClose}><X size={20} /></button>
      <h2 id="robo-local-skill-title">添加本地技能</h2>
      <p>选择包含 SKILL.md 的技能文件夹，添加后即可在本机使用。</p>
      <form onSubmit={event => { event.preventDefault(); void add() }}>
        <button ref={picker} type="button" className="roboMarketAdded" disabled={busy} onClick={() => { void pick() }}><FolderOpen size={16} />选择文件夹</button>
        <label>技能文件夹<input aria-label="技能文件夹路径" placeholder="选择文件夹或填写完整路径" value={directory} disabled={busy} onChange={event => { setDirectory(event.target.value) }} /></label>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" className="roboMarketAdded" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="roboMarketAdd" disabled={busy || !directory.trim()}>{busy ? '处理中…' : '添加到本机'}</button></footer>
      </form>
      <p className="roboLocalSkillPublish">想分享技能？<a href="https://dash.openfox.work/workbench/skills" target="_blank" rel="noopener noreferrer">前往官网工作台上传</a>，审核通过后上架。</p>
    </dialog>}
  </>
}

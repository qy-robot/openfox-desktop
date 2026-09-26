/** Application-level PowerShell/SSH drawer backed by a Host-owned PTY. */

import type { Context } from '@deepseek-ai/cordis'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CirclePlay, RotateCcw, Send, ShieldCheck, SquareTerminal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopPowerShellTarget } from '../desktop-powershell-contract.ts'
import { createDesktopPowerShellApi, type DesktopPowerShellApi } from './desktop-powershell-api.ts'
import { installDesktopPowerShellStyles } from './desktop-powershell-styles.ts'
import type { RoboDeviceSelection, RoboDeviceSelectionSnapshot } from './robo-device-selection.ts'

import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export interface DesktopPowerShellEntry {
  readonly callId: string
  readonly command: string
  readonly output: string
  readonly state: 'running' | 'complete' | 'error'
  readonly time: number
}

const ZH = {
  button: '终端', title: '终端', local: '设备本机 · PowerShell', robot: '机器人 · SSH', close: '关闭终端',
  waiting: '正在启动终端…', unavailable: '已选择机器人，但机器人选择尚未提供 SSH 连接信息。',
  empty: '终端已连接，等待输入。', input: '输入命令', send: '运行', interrupt: '中断', reconnect: '重新连接',
  exited: '终端已退出', failed: '终端连接失败', running: '运行中', complete: '已完成', error: '运行失败',
  approvalTitle: '即将运行命令', approvalReason: 'OpenFox 需要你的确认后才能运行这段代码。', run: '运行', cancel: '取消',
  modelActivity: '对话命令记录',
} as const

const EN = {
  button: 'Terminal', title: 'Terminal', local: 'This device · PowerShell', robot: 'Robot · SSH', close: 'Close terminal',
  waiting: 'Starting terminal…', unavailable: 'A robot is selected, but its SSH connection is not available yet.',
  empty: 'Terminal connected and ready.', input: 'Enter a command', send: 'Run', interrupt: 'Interrupt', reconnect: 'Reconnect',
  exited: 'Terminal exited', failed: 'Terminal connection failed', running: 'Running', complete: 'Completed', error: 'Failed',
  approvalTitle: 'Command ready to run', approvalReason: 'OpenFox needs your confirmation before it runs this code.', run: 'Run', cancel: 'Cancel',
  modelActivity: 'Conversation command history',
} as const

function copy() { return navigator.language.toLowerCase().startsWith('zh') ? ZH : EN }

export function isPowerShellToolName(name: string | undefined): boolean {
  if (name === undefined) return false
  const normalized = name.toLowerCase().replaceAll('_', '-').trim()
  return normalized === 'pwsh' || normalized === 'powershell' || normalized.endsWith('-pwsh')
}

export function parsePowerShellCommand(argsRaw: string | undefined): string {
  if (argsRaw === undefined || argsRaw.trim().length === 0) return ''
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>
      for (const key of ['command', 'code', 'text']) if (typeof record[key] === 'string') return record[key]
    }
  } catch {}
  return argsRaw
}

function contentText(content: ToolResultNode['content']): string {
  return content.map(block => {
    if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') return block.text
    try { return JSON.stringify(block, null, 2) } catch { return String(block) }
  }).join('\n').trim()
}

function visitPowerShellBlocks(block: ToolCallBlock, entries: DesktopPowerShellEntry[]): void {
  const settled = 'kind' in block && block.kind === 'tool-result'
  const name = settled ? block.call?.name : ('name' in block ? block.name : undefined)
  if (isPowerShellToolName(name)) {
    const argsRaw = settled ? block.call?.argsRaw : ('argsRaw' in block ? block.argsRaw : undefined)
    entries.push({ callId: block.callId, command: parsePowerShellCommand(argsRaw), output: settled ? contentText(block.content) : '',
      state: settled ? (block.isError ? 'error' : 'complete') : 'running', time: block.time })
  }
  for (const child of block.subCalls) visitPowerShellBlocks(child, entries)
}

/** Build a chronological, de-duplicated PowerShell ledger from the Chat compatibility projection. */
export function collectPowerShellEntries(snapshot: Pick<ChatSnapshot, 'legacy'>): readonly DesktopPowerShellEntry[] {
  const byCall = new Map<string, DesktopPowerShellEntry>()
  const candidates: ToolCallBlock[] = [
    ...snapshot.legacy.nodes.filter((node): node is ToolResultNode => node.kind === 'tool-result'),
    ...snapshot.legacy.runningCalls,
  ]
  for (const block of candidates) {
    const entries: DesktopPowerShellEntry[] = []
    visitPowerShellBlocks(block, entries)
    for (const entry of entries) byCall.set(entry.callId, entry)
  }
  return [...byCall.values()].sort((left, right) => left.time - right.time).slice(-60)
}

function isPowerShellApproval(value: unknown): value is PendingApproval {
  if (typeof value !== 'object' || value === null) return false
  const approval = value as { readonly kind?: unknown; readonly toolName?: unknown }
  return approval.kind === 'approval' && typeof approval.toolName === 'string' && isPowerShellToolName(approval.toolName)
}

/** Route an empty selection to local PowerShell and a complete robot selection to SSH. */
export function terminalTargetForSelection(selection: RoboDeviceSelectionSnapshot, label: string): DesktopPowerShellTarget | undefined {
  if (selection.modelId === '') return { kind: 'local' }
  if (selection.ssh === undefined) return undefined
  return { kind: 'robot', modelId: selection.modelId, profileId: selection.profileId,
    label: label || selection.modelId, ssh: selection.ssh }
}

interface ConversationView { readonly entries: readonly DesktopPowerShellEntry[]; readonly pending?: PendingApproval }
const EMPTY_VIEW: ConversationView = { entries: [] }
let currentView = EMPTY_VIEW
let currentOwner: symbol | undefined
const viewListeners = new Set<() => void>()

function publishView(owner: symbol, view: ConversationView): void {
  currentOwner = owner; currentView = view
  for (const listener of viewListeners) listener()
}
function clearView(owner: symbol): void {
  if (currentOwner !== owner) return
  currentOwner = undefined; currentView = EMPTY_VIEW
  for (const listener of viewListeners) listener()
}
function subscribeView(listener: () => void): () => void {
  viewListeners.add(listener); return () => { viewListeners.delete(listener) }
}

type TerminalStatus = 'idle' | 'connecting' | 'ready' | 'exited' | 'error'

export function DesktopPowerShellLauncher({ device, api }: { readonly device: RoboDeviceSelection; readonly api: DesktopPowerShellApi }) {
  const labels = copy()
  const view = useSyncExternalStore(subscribeView, () => currentView, () => EMPTY_VIEW)
  const selection = useSyncExternalStore(device.subscribe, device.getSnapshot, device.getSnapshot)
  const modelLabel = device.getModelLabel()
  const target = useMemo(() => terminalTargetForSelection(selection, modelLabel), [selection, modelLabel])
  const targetKey = target === undefined ? `missing:${selection.modelId}:${selection.profileId}` : JSON.stringify(target)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>('idle')
  const [output, setOutput] = useState('')
  const [failure, setFailure] = useState('')
  const [input, setInput] = useState('')
  const [answering, setAnswering] = useState(false)
  const [generation, setGeneration] = useState(0)
  const sessionId = useRef<string>()
  const offset = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = view.pending
  const runningKey = view.entries.filter(entry => entry.state === 'running').map(entry => entry.callId).join('|')

  useEffect(() => { if (pending !== undefined || runningKey.length > 0) setOpen(true) }, [pending?.key, runningKey])
  useEffect(() => {
    if (!open) { setStatus('idle'); return }
    if (target === undefined) { setStatus('error'); setFailure(labels.unavailable); setOutput(''); return }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let ownedSession = ''
    setStatus('connecting'); setFailure(''); setOutput(''); offset.current = 0
    const poll = async (): Promise<void> => {
      if (controller.signal.aborted || ownedSession === '') return
      try {
        const result = await api.read(ownedSession, offset.current, controller.signal)
        offset.current = result.offset
        if (result.output.length > 0) setOutput(previous => result.truncated ? result.output : `${previous}${result.output}`.slice(-500_000))
        if (result.exited) { setStatus('exited'); return }
      } catch (cause) {
        if (!controller.signal.aborted) { setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed) }
        return
      }
      timer = setTimeout(() => { void poll() }, 120)
    }
    void api.open(target, 120, 32, controller.signal).then(result => {
      if (controller.signal.aborted) { void api.close(result.sessionId).catch(() => {}); return }
      ownedSession = result.sessionId; sessionId.current = result.sessionId; offset.current = result.offset
      setOutput(result.output); setStatus('ready'); void poll(); queueMicrotask(() => { inputRef.current?.focus() })
    }).catch(cause => {
      if (!controller.signal.aborted) { setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed) }
    })
    return () => {
      controller.abort(); if (timer !== undefined) clearTimeout(timer)
      if (sessionId.current === ownedSession) sessionId.current = undefined
      if (ownedSession !== '') void api.close(ownedSession).catch(() => {})
    }
  }, [api, generation, labels.failed, labels.unavailable, open, targetKey])

  useEffect(() => {
    if (!open) return
    const scroll = scrollRef.current
    if (scroll !== null) scroll.scrollTop = scroll.scrollHeight
  }, [open, output, view.entries, pending?.key])

  const answer = (decision: 'allowed-once' | 'rejected'): void => {
    if (pending === undefined || answering) return
    setAnswering(true); void pending.answer(decision).finally(() => { setAnswering(false) })
  }
  const approvalCommand = pending?.callId === undefined ? '' : view.entries.find(entry => entry.callId === pending.callId)?.command ?? ''
  const send = (data: string): void => {
    const id = sessionId.current
    if (id === undefined || status !== 'ready' || data.length === 0) return
    void api.write(id, data).catch(cause => { setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed) })
  }
  const submit = (): void => { if (input.length > 0) { send(`${input}\r`); setInput('') } }
  const targetTitle = selection.modelId !== ''
    ? `${labels.robot} · ${target?.kind === 'robot' ? target.label : modelLabel || selection.modelId}`
    : labels.local

  return <>
    <button type="button" className="dshDesktopPowerShellButton" aria-label={labels.button} aria-expanded={open}
      title={labels.button} onClick={() => { setOpen(value => !value) }}>
      <SquareTerminal aria-hidden="true" /><span>{labels.button}</span>
      {(pending !== undefined || runningKey.length > 0) && <i className="dshDesktopPowerShellActivity" aria-hidden="true" />}
    </button>
    {open && <aside className="dshDesktopPowerShellDrawer" aria-label={labels.title}>
      <header className="dshDesktopPowerShellHeader"><SquareTerminal aria-hidden="true" /><div><strong>{labels.title}</strong><small>{targetTitle}</small></div>
        <button type="button" aria-label={labels.reconnect} title={labels.reconnect} onClick={() => { setGeneration(value => value + 1) }}><RotateCcw aria-hidden="true" /></button>
        <button type="button" aria-label={labels.close} title={labels.close} onClick={() => { setOpen(false) }}><X aria-hidden="true" /></button>
      </header>
      <div className="dshDesktopPowerShellScroll" ref={scrollRef} role="log" aria-live="polite">
        {status === 'connecting' && <p className="dshDesktopPowerShellNotice">{labels.waiting}</p>}
        {status === 'error' && <p className="dshDesktopPowerShellNotice" data-error>{failure || labels.failed}</p>}
        {status === 'exited' && <p className="dshDesktopPowerShellNotice">{labels.exited}</p>}
        <pre className="dshDesktopPowerShellLiveOutput">{output || (status === 'ready' ? labels.empty : '')}</pre>
        {view.entries.length > 0 && <section className="dshDesktopPowerShellConversationLog"><h3>{labels.modelActivity}</h3>{view.entries.map(entry =>
          <article key={entry.callId}><pre><span>PS&gt; </span>{entry.command}</pre>{entry.output && <pre>{entry.output}</pre>}
            <small data-state={entry.state}>{labels[entry.state]}</small></article>)}</section>}
      </div>
      <form className="dshDesktopPowerShellInput" onSubmit={event => { event.preventDefault(); submit() }}>
        <span>PS&gt;</span><input ref={inputRef} aria-label={labels.input} placeholder={labels.input} value={input}
          disabled={status !== 'ready'} onChange={event => { setInput(event.target.value) }} />
        <button type="button" disabled={status !== 'ready'} title={labels.interrupt} onClick={() => { send('\u0003') }}>Ctrl+C</button>
        <button type="submit" data-primary disabled={status !== 'ready' || input.length === 0}><Send aria-hidden="true" />{labels.send}</button>
      </form>
      {pending !== undefined && <section className="dshDesktopPowerShellApproval" aria-label={labels.approvalTitle}>
        <div className="dshDesktopPowerShellApprovalHeader"><ShieldCheck aria-hidden="true" />{labels.approvalTitle}</div>
        <p>{pending.reason ?? labels.approvalReason}</p>{approvalCommand && <pre>{approvalCommand}</pre>}
        <div><button type="button" disabled={answering} onClick={() => { answer('rejected') }}>{labels.cancel}</button>
          <button type="button" data-primary disabled={answering} onClick={() => { answer('allowed-once') }}><CirclePlay aria-hidden="true" />{labels.run}</button></div>
      </section>}
    </aside>}
  </>
}

export type DesktopPowerShellProps = PropsRuntime<'conversation.session.header.utilities'>

/** Invisible bridge from the active conversation to the application-level terminal. */
export function DesktopPowerShell({ sessionId: activeSessionId, useChat, useSessionPendingInteraction }: DesktopPowerShellProps) {
  const legacy = useChat(snapshot => snapshot.legacy)
  const entries = useMemo(() => collectPowerShellEntries({ legacy }), [legacy])
  const pending = useSessionPendingInteraction(snapshot => {
    const interaction = snapshot.get(activeSessionId)
    return isPowerShellApproval(interaction) ? interaction : undefined
  })
  const owner = useRef(Symbol('desktop-powershell-session'))
  useEffect(() => { publishView(owner.current, { entries, ...(pending === undefined ? {} : { pending }) }) }, [entries, pending])
  useEffect(() => () => { clearView(owner.current) }, [])
  return null
}

function installDesktopPowerShellLauncher(device: RoboDeviceSelection): () => void {
  document.getElementById('dsh-desktop-powershell-root')?.remove()
  const host = document.createElement('div'); host.id = 'dsh-desktop-powershell-root'; document.body.appendChild(host)
  const root = createRoot(host); root.render(<DesktopPowerShellLauncher device={device} api={createDesktopPowerShellApi()} />)
  return () => { root.unmount(); host.remove(); currentOwner = undefined; currentView = EMPTY_VIEW }
}

/** Mount the Windows application-level launcher and bridge the active conversation into it. */
export function applyDesktopPowerShell(ctx: Context, device: RoboDeviceSelection): void {
  ctx.effect(installDesktopPowerShellStyles, 'dsh-plugin-desktop: PowerShell drawer styles')
  ctx.effect(() => installDesktopPowerShellLauncher(device), 'dsh-plugin-desktop: application-level PowerShell launcher')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'desktop-powershell-session-bridge', order: 90,
  }, DesktopPowerShell))
}

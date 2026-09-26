/** PowerShell/SSH tab embedded in the application's existing right Sidebar. */

import type { Context } from '@deepseek-ai/cordis'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISidebarRight, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { CirclePlay, Pencil, Plus, RotateCcw, Send, Server, Settings2, ShieldCheck, SquareTerminal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopPowerShellTarget } from '../desktop-powershell-contract.ts'
import { createDesktopPowerShellApi, type DesktopPowerShellApi } from './desktop-powershell-api.ts'
import { installDesktopPowerShellStyles } from './desktop-powershell-styles.ts'
import {
  createDesktopSshConnections, type DesktopSshConnections, type DesktopSshProfile,
} from './desktop-ssh-connections.ts'
import {
  createDesktopTerminalShortcuts, DESKTOP_TERMINAL_SHORTCUT_LIMIT,
  type DesktopTerminalShortcut, type DesktopTerminalShortcuts,
} from './desktop-terminal-shortcuts.ts'
import type { RoboDeviceSelection, RoboDeviceSelectionSnapshot } from './robo-device-selection.ts'

import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extensible action row pinned to the bottom of the Desktop terminal. */
    'desktop.powershell.footer.action': {
      kind: 'list'
      scope: 'session'
      owner: DesktopPowerShellFooterActionContext
    }
  }
}

export interface DesktopPowerShellEntry {
  readonly callId: string
  readonly command: string
  readonly output: string
  readonly state: 'running' | 'complete' | 'error'
  readonly time: number
}

const ZH = {
  button: '终端', title: '终端', local: '设备本机 · PowerShell', robot: '机器人 SSH', close: '关闭终端',
  localEntry: '进入本机设备终端', robotEntry: '进入机器人终端',
  localTab: '本机终端', robotTab: '机器人终端',
  localGuide: '在当前设备上打开 PowerShell', robotGuide: '通过 SSH 连接当前选择的机器人',
  waiting: '正在启动终端…', unavailable: '请先选择机器人，并确保机器人选择已提供 SSH 连接信息。',
  empty: '终端已连接，等待输入。', input: '输入命令', send: '运行', interrupt: '中断', reconnect: '重新连接',
  exited: '终端已退出', failed: '终端连接失败', running: '运行中', complete: '已完成', error: '运行失败',
  approvalTitle: '即将运行命令', approvalReason: 'OpenFox 需要你的确认后才能运行这段代码。', run: '运行', cancel: '取消',
  modelActivity: '对话命令记录', actions: '终端操作', shortcuts: '快捷命令', customize: '自定义按键',
  shortcutLabel: '按键名称', shortcutCommand: '命令', shortcutBehavior: '点击后', runNow: '立即运行', fillInput: '填入命令框',
  addShortcut: '添加按键', removeShortcut: '删除按键', resetShortcuts: '恢复默认', saveShortcuts: '保存',
  cancelEdit: '取消', emptyShortcuts: '还没有快捷按键，可以在这里添加。', shortcutLimit: '快捷按键已达到上限。',
  connections: 'SSH 连接', connectionManager: '连接管理', recentConnections: '最近连接', newConnection: '新建连接',
  noConnections: '还没有连接记录。填写 IP 和用户名后即可连接。', connectionName: '连接名称',
  host: 'IP / 主机', username: '用户名', port: '端口', password: '密码', passwordHint: '密码仅用于本次连接，不会保存到连接记录。',
  connect: '连接', editConnection: '编辑连接', deleteConnection: '删除连接', currentConnection: '当前连接',
  connectFirst: '命令已放入输入框。请先连接终端，再点击运行。', invalidPort: '端口必须是 1-65535 之间的整数。',
} as const

const EN = {
  button: 'Terminal', title: 'Terminal', local: 'This device · PowerShell', robot: 'Robot SSH', close: 'Close terminal',
  localEntry: 'Open device terminal', robotEntry: 'Open robot terminal',
  localTab: 'Device terminal', robotTab: 'Robot terminal',
  localGuide: 'Open PowerShell on this device', robotGuide: 'Connect to the selected robot over SSH',
  waiting: 'Starting terminal…', unavailable: 'Select a robot and make sure its SSH connection is available.',
  empty: 'Terminal connected and ready.', input: 'Enter a command', send: 'Run', interrupt: 'Interrupt', reconnect: 'Reconnect',
  exited: 'Terminal exited', failed: 'Terminal connection failed', running: 'Running', complete: 'Completed', error: 'Failed',
  approvalTitle: 'Command ready to run', approvalReason: 'OpenFox needs your confirmation before it runs this code.', run: 'Run', cancel: 'Cancel',
  modelActivity: 'Conversation command history', actions: 'Terminal actions', shortcuts: 'Quick commands', customize: 'Customize buttons',
  shortcutLabel: 'Button label', shortcutCommand: 'Command', shortcutBehavior: 'On click', runNow: 'Run now', fillInput: 'Fill command box',
  addShortcut: 'Add button', removeShortcut: 'Remove button', resetShortcuts: 'Restore defaults', saveShortcuts: 'Save',
  cancelEdit: 'Cancel', emptyShortcuts: 'No quick buttons yet. Add one here.', shortcutLimit: 'The quick-button limit has been reached.',
  connections: 'SSH connections', connectionManager: 'Connection manager', recentConnections: 'Recent connections', newConnection: 'New connection',
  noConnections: 'No saved connections yet. Enter an IP and user name to connect.', connectionName: 'Connection name',
  host: 'IP / host', username: 'User name', port: 'Port', password: 'Password', passwordHint: 'The password is used only for this connection and is never saved.',
  connect: 'Connect', editConnection: 'Edit connection', deleteConnection: 'Delete connection', currentConnection: 'Current connection',
  connectFirst: 'The command is in the command box. Connect a terminal before running it.', invalidPort: 'Port must be an integer from 1 to 65535.',
} as const

function copy() { return navigator.language.toLowerCase().startsWith('zh') ? ZH : EN }

function TerminalGuideIcon({
  size,
  className,
}: { readonly size?: number | undefined; readonly className?: string | undefined }): JSX.Element {
  return <SquareTerminal aria-hidden="true" size={size ?? 16} className={className ?? ''} />
}

export const DESKTOP_POWERSHELL_TAB_ID = 'dsh-plugin-desktop/powershell'
export const DESKTOP_POWERSHELL_TAB_KIND = 'desktop-powershell'
export const DESKTOP_ROBOT_TERMINAL_TAB_ID = 'dsh-plugin-desktop/powershell-robot'
export const DESKTOP_ROBOT_TERMINAL_TAB_KIND = 'desktop-powershell-robot'
export type DesktopPowerShellMode = 'local' | 'robot'

/** Register one explicit terminal destination as a first-class right-Sidebar page. */
export function desktopPowerShellTabDefinition(mode: DesktopPowerShellMode = 'local'): SidebarRightTabDefinition {
  const labels = copy()
  const robot = mode === 'robot'
  return {
    id: robot ? DESKTOP_ROBOT_TERMINAL_TAB_ID : DESKTOP_POWERSHELL_TAB_ID,
    kind: robot ? DESKTOP_ROBOT_TERMINAL_TAB_KIND : DESKTOP_POWERSHELL_TAB_KIND,
    title: () => robot ? labels.robotTab : labels.localTab,
    guide: [{
      order: robot ? 41 : 40,
      title: () => robot ? labels.robotEntry : labels.localEntry,
      description: () => robot ? labels.robotGuide : labels.localGuide,
      icon: TerminalGuideIcon,
    }],
  }
}

export function desktopPowerShellTabDefinitions(): readonly SidebarRightTabDefinition[] {
  return [desktopPowerShellTabDefinition('local'), desktopPowerShellTabDefinition('robot')]
}

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

/** Resolve the destination chosen explicitly on the right-Sidebar guide page. */
export function terminalTargetForMode(
  mode: DesktopPowerShellMode,
  selection: RoboDeviceSelectionSnapshot,
  label: string,
): DesktopPowerShellTarget | undefined {
  if (mode === 'local') return { kind: 'local' }
  if (selection.modelId === '') return undefined
  return terminalTargetForSelection(selection, label)
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

export type DesktopPowerShellStatus = 'idle' | 'connecting' | 'ready' | 'exited' | 'error'

/** Public owner share for plugins adding user-configurable terminal actions. */
export interface DesktopPowerShellFooterActionContext {
  readonly pending: PendingApproval | undefined
  readonly command: string
  readonly answering: boolean
  readonly status: DesktopPowerShellStatus
  readonly target: DesktopPowerShellTarget | undefined
  readonly answer: (decision: 'allowed-once' | 'rejected') => void
  readonly runCommand: (command: string) => void
  readonly fillCommand: (command: string) => void
}

let panelVisible = false
const visiblePanels = new Set<symbol>()
const panelVisibilityListeners = new Set<() => void>()

function publishPanelVisibility(owner: symbol, visible: boolean): void {
  if (visible) visiblePanels.add(owner)
  else visiblePanels.delete(owner)
  visible = visiblePanels.size > 0
  if (panelVisible === visible) return
  panelVisible = visible
  for (const listener of panelVisibilityListeners) listener()
}

function subscribePanelVisibility(listener: () => void): () => void {
  panelVisibilityListeners.add(listener)
  return () => { panelVisibilityListeners.delete(listener) }
}

type TerminalNavigation = Pick<ISidebarRight, 'active' | 'isExpanded' | 'openTab' | 'toggleExpanded'>

/** Late-bound right-Sidebar navigation used by the always-mounted shell entry. */
export interface DesktopPowerShellNavigation {
  readonly getSnapshot: () => TerminalNavigation | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly attach: (sidebarRight: TerminalNavigation) => () => void
}

/** Keep the title-bar entry independent from right-Sidebar provider ordering. */
export function createDesktopPowerShellNavigation(): DesktopPowerShellNavigation {
  let current: TerminalNavigation | undefined
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => current,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    attach: sidebarRight => {
      current = sidebarRight
      publish()
      return () => {
        if (current !== sidebarRight) return
        current = undefined
        publish()
      }
    },
  }
}

/** Application-level entry that opens the terminal inside the existing right Sidebar. */
export function DesktopPowerShellLauncher({
  navigation,
  device,
}: { readonly navigation: DesktopPowerShellNavigation; readonly device: RoboDeviceSelection }) {
  const labels = copy()
  const view = useSyncExternalStore(subscribeView, () => currentView, () => EMPTY_VIEW)
  const open = useSyncExternalStore(subscribePanelVisibility, () => panelVisible, () => false)
  const sidebarRight = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const pending = view.pending
  const runningKey = view.entries.filter(entry => entry.state === 'running').map(entry => entry.callId).join('|')
  const selection = useSyncExternalStore(device.subscribe, device.getSnapshot, device.getSnapshot)
  const preferredKind = selection.modelId === '' ? DESKTOP_POWERSHELL_TAB_KIND : DESKTOP_ROBOT_TERMINAL_TAB_KIND
  const toggle = (): void => {
    if (sidebarRight === undefined) return
    const active = sidebarRight.active()
    if (sidebarRight.isExpanded() && (active?.kind === DESKTOP_POWERSHELL_TAB_KIND || active?.kind === DESKTOP_ROBOT_TERMINAL_TAB_KIND)) {
      sidebarRight.toggleExpanded()
      return
    }
    sidebarRight.openTab(preferredKind)
  }

  return <button type="button" className="dshDesktopPowerShellButton" aria-label={labels.button} aria-expanded={open}
    aria-disabled={sidebarRight === undefined} disabled={sidebarRight === undefined} title={labels.button} onClick={toggle}>
    <SquareTerminal aria-hidden="true" /><span>{labels.button}</span>
    {(pending !== undefined || runningKey.length > 0) && <i className="dshDesktopPowerShellActivity" aria-hidden="true" />}
  </button>
}

export type DesktopPowerShellPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  readonly device: RoboDeviceSelection
  readonly api: DesktopPowerShellApi
  readonly mode: DesktopPowerShellMode
  readonly shortcuts: DesktopTerminalShortcuts
  readonly connections: DesktopSshConnections
} & PropsRenderSlots<'desktop.powershell.footer.action'>

/** Shipped approval buttons; additional actions can join the same list Slot. */
export function DesktopPowerShellApprovalActions({
  pending,
  answering,
  answer,
}: DesktopPowerShellFooterActionContext): JSX.Element | null {
  if (pending === undefined) return null
  const labels = copy()
  return <div className="dshDesktopPowerShellDefaultActions">
    <button type="button" disabled={answering} onClick={() => { answer('rejected') }}>{labels.cancel}</button>
    <button type="button" data-primary disabled={answering} onClick={() => { answer('allowed-once') }}>
      <CirclePlay aria-hidden="true" />{labels.run}
    </button>
  </div>
}

let shortcutSequence = 0
function newShortcut(): DesktopTerminalShortcut {
  shortcutSequence += 1
  return { id: `shortcut-${Date.now().toString(36)}-${String(shortcutSequence)}`, label: '', command: '', behavior: 'run' }
}

function DesktopTerminalShortcutBar({
  shortcuts,
  status,
  runCommand,
  fillCommand,
}: {
  readonly shortcuts: DesktopTerminalShortcuts
  readonly status: DesktopPowerShellStatus
  readonly runCommand: (command: string) => void
  readonly fillCommand: (command: string) => void
}): JSX.Element {
  const labels = copy()
  const saved = useSyncExternalStore(shortcuts.subscribe, shortcuts.getSnapshot, shortcuts.getSnapshot)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<readonly DesktopTerminalShortcut[]>(saved)
  const [failure, setFailure] = useState('')
  const ready = status === 'ready'
  const beginEditing = (): void => { setDraft(saved.map(shortcut => ({ ...shortcut }))); setFailure(''); setEditing(true) }
  const update = (id: string, patch: Partial<DesktopTerminalShortcut>): void => {
    setDraft(current => current.map(shortcut => shortcut.id === id ? { ...shortcut, ...patch } : shortcut))
  }
  const save = (): void => {
    try {
      shortcuts.save(draft.map(shortcut => ({ ...shortcut, label: shortcut.label.trim(), command: shortcut.command.trim() })))
      setFailure(''); setEditing(false)
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)) }
  }
  const reset = (): void => {
    try { shortcuts.reset(); setFailure(''); setEditing(false) }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <div className="dshDesktopTerminalShortcutArea">
    <div className="dshDesktopTerminalShortcutBar" role="toolbar" aria-label={labels.shortcuts}>
      <div className="dshDesktopTerminalShortcutList">
        {saved.map(shortcut => <button key={shortcut.id} type="button"
          title={`${shortcut.behavior === 'run' ? labels.runNow : labels.fillInput}: ${shortcut.command}`}
          data-terminal-shortcut={shortcut.behavior}
          onClick={() => { shortcut.behavior === 'run' && ready ? runCommand(shortcut.command) : fillCommand(shortcut.command) }}>
          {shortcut.label}
        </button>)}
      </div>
      <button type="button" className="dshDesktopTerminalShortcutSettings" aria-expanded={editing}
        onClick={() => { editing ? setEditing(false) : beginEditing() }}>
        <Settings2 aria-hidden="true" />{labels.customize}
      </button>
    </div>
    {editing && <section className="dshDesktopTerminalShortcutEditor" aria-label={labels.customize}>
      <div className="dshDesktopTerminalShortcutRows">
        {draft.length === 0 && <p>{labels.emptyShortcuts}</p>}
        {draft.map(shortcut => <div className="dshDesktopTerminalShortcutRow" key={shortcut.id}>
          <label><span>{labels.shortcutLabel}</span><input value={shortcut.label} maxLength={16}
            onChange={event => { update(shortcut.id, { label: event.target.value }) }} /></label>
          <label><span>{labels.shortcutCommand}</span><input value={shortcut.command} maxLength={2_000}
            onChange={event => { update(shortcut.id, { command: event.target.value }) }} /></label>
          <label><span>{labels.shortcutBehavior}</span><select value={shortcut.behavior}
            onChange={event => { update(shortcut.id, { behavior: event.target.value as DesktopTerminalShortcut['behavior'] }) }}>
            <option value="run">{labels.runNow}</option><option value="fill">{labels.fillInput}</option>
          </select></label>
          <button type="button" aria-label={labels.removeShortcut} title={labels.removeShortcut}
            onClick={() => { setDraft(current => current.filter(item => item.id !== shortcut.id)) }}><Trash2 aria-hidden="true" /></button>
        </div>)}
      </div>
      {failure && <p className="dshDesktopTerminalShortcutError" role="alert">{failure}</p>}
      <div className="dshDesktopTerminalShortcutEditorActions">
        <button type="button" onClick={reset}>{labels.resetShortcuts}</button>
        <button type="button" disabled={draft.length >= DESKTOP_TERMINAL_SHORTCUT_LIMIT}
          title={draft.length >= DESKTOP_TERMINAL_SHORTCUT_LIMIT ? labels.shortcutLimit : labels.addShortcut}
          onClick={() => { setDraft(current => [...current, newShortcut()]) }}><Plus aria-hidden="true" />{labels.addShortcut}</button>
        <span />
        <button type="button" onClick={() => { setEditing(false); setFailure('') }}>{labels.cancelEdit}</button>
        <button type="button" data-primary onClick={save}>{labels.saveShortcuts}</button>
      </div>
    </section>}
  </div>
}

interface DesktopSshDraft {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly user: string
  readonly port: string
  readonly password: string
}

let connectionSequence = 0
function connectionDraft(
  profile: DesktopSshProfile | undefined,
  selection: RoboDeviceSelectionSnapshot,
  modelLabel: string,
): DesktopSshDraft {
  return {
    id: profile?.id ?? '',
    label: profile?.label ?? (modelLabel || selection.modelId),
    host: profile?.host ?? selection.ssh?.host ?? '',
    user: profile?.user ?? selection.ssh?.user ?? '',
    port: String(profile?.port ?? selection.ssh?.port ?? 22),
    password: '',
  }
}

/** Turn a saved MobaXterm-style connection into a Host-owned SSH target. */
export function terminalTargetForSshProfile(
  profile: DesktopSshProfile,
  selection: RoboDeviceSelectionSnapshot,
): DesktopPowerShellTarget {
  return {
    kind: 'robot',
    modelId: profile.modelId ?? (selection.modelId || `saved:${profile.id}`),
    profileId: profile.profileId ?? (selection.modelId === '' ? 'manual-ssh' : selection.profileId),
    label: profile.label,
    ssh: { host: profile.host, ...(profile.user === undefined ? {} : { user: profile.user }),
      ...(profile.port === undefined ? {} : { port: profile.port }) },
  }
}

function stripTerminalControlSequences(value: string): string {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

/** Match OpenSSH password prompts without treating ordinary output as a credential request. */
export function hasSshPasswordPrompt(value: string): boolean {
  const text = stripTerminalControlSequences(value).slice(-240)
  return /(?:password(?:\s+for\s+[^\r\n:]+)?|\u5bc6\u7801)\s*[:\uff1a]\s*$/iu.test(text)
}

function DesktopSshConnectionPane({
  profiles,
  activeConnectionId,
  target,
  draft,
  editing,
  failure,
  compact,
  onConnect,
  onEdit,
  onDelete,
  onChange,
  onSubmit,
  onCancel,
}: {
  readonly profiles: readonly DesktopSshProfile[]
  readonly activeConnectionId: string | undefined
  readonly target: DesktopPowerShellTarget | undefined
  readonly draft: DesktopSshDraft
  readonly editing: boolean
  readonly failure: string
  readonly compact: boolean
  readonly onConnect: (profile: DesktopSshProfile) => void
  readonly onEdit: (profile?: DesktopSshProfile) => void
  readonly onDelete: (id: string) => void
  readonly onChange: (patch: Partial<DesktopSshDraft>) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}): JSX.Element {
  const labels = copy()
  const current = target?.kind === 'robot' ? `${target.label}  ${target.ssh.host}` : labels.unavailable
  return <aside className={compact ? 'dshDesktopSshCompact' : 'dshDesktopSshRail'} aria-label={labels.connections}>
    <div className="dshDesktopSshPaneHeader">
      <div><strong>{compact ? labels.currentConnection : labels.connections}</strong><small>{current}</small></div>
      <button type="button" title={labels.newConnection} onClick={() => { onEdit() }}>
        <Plus aria-hidden="true" />{compact ? labels.connectionManager : labels.newConnection}
      </button>
    </div>
    {!compact && <div className="dshDesktopSshProfileList" aria-label={labels.recentConnections}>
      <h3>{labels.recentConnections}</h3>
      {profiles.length === 0 && <p>{labels.noConnections}</p>}
      {profiles.map(profile => <div className="dshDesktopSshProfile" data-active={activeConnectionId === profile.id || undefined} key={profile.id}>
        <button type="button" className="dshDesktopSshProfileConnect" onClick={() => { onConnect(profile) }}>
          <Server aria-hidden="true" /><span><strong>{profile.label}</strong><small>{profile.user ? `${profile.user}@${profile.host}` : profile.host}{profile.port && profile.port !== 22 ? `:${String(profile.port)}` : ''}</small></span>
        </button>
        <button type="button" className="dshDesktopSshProfileAction" aria-label={labels.editConnection} title={labels.editConnection}
          onClick={() => { onEdit(profile) }}><Pencil aria-hidden="true" /></button>
        <button type="button" className="dshDesktopSshProfileAction" aria-label={labels.deleteConnection} title={labels.deleteConnection}
          onClick={() => { onDelete(profile.id) }}><Trash2 aria-hidden="true" /></button>
      </div>)}
    </div>}
    {editing && <form className="dshDesktopSshEditor" onSubmit={event => { event.preventDefault(); onSubmit() }}>
      <label><span>{labels.connectionName}</span><input required maxLength={80} value={draft.label}
        onChange={event => { onChange({ label: event.target.value }) }} /></label>
      <label><span>{labels.host}</span><input required maxLength={253} value={draft.host} autoComplete="off"
        onChange={event => { onChange({ host: event.target.value }) }} /></label>
      <div className="dshDesktopSshEditorPair">
        <label><span>{labels.username}</span><input maxLength={128} value={draft.user} autoComplete="username"
          onChange={event => { onChange({ user: event.target.value }) }} /></label>
        <label><span>{labels.port}</span><input required inputMode="numeric" value={draft.port}
          onChange={event => { onChange({ port: event.target.value }) }} /></label>
      </div>
      <label><span>{labels.password}</span><input type="password" value={draft.password} autoComplete="current-password"
        onChange={event => { onChange({ password: event.target.value }) }} /></label>
      <p>{labels.passwordHint}</p>
      {failure && <p className="dshDesktopSshEditorError" role="alert">{failure}</p>}
      <div className="dshDesktopSshEditorActions">
        <button type="button" onClick={onCancel}>{labels.cancelEdit}</button>
        <button type="submit" data-primary><Server aria-hidden="true" />{labels.connect}</button>
      </div>
    </form>}
  </aside>
}

/** Session-aware terminal body rendered by the application's native right Sidebar. */
export function DesktopPowerShellPanel({ device, api, mode, shortcuts, connections, useTabInfo, renderSlot }: DesktopPowerShellPanelProps) {
  const labels = copy()
  const view = useSyncExternalStore(subscribeView, () => currentView, () => EMPTY_VIEW)
  const selection = useSyncExternalStore(device.subscribe, device.getSnapshot, device.getSnapshot)
  const profiles = useSyncExternalStore(connections.subscribe, connections.getSnapshot, connections.getSnapshot)
  const modelLabel = device.getModelLabel()
  const [activeConnectionId, setActiveConnectionId] = useState<string>()
  const activeProfile = profiles.find(profile => profile.id === activeConnectionId)
  const target = useMemo(() => mode === 'local'
    ? terminalTargetForMode(mode, selection, modelLabel)
    : activeProfile === undefined ? terminalTargetForMode(mode, selection, modelLabel) : terminalTargetForSshProfile(activeProfile, selection),
  [activeProfile, mode, modelLabel, selection])
  const targetKey = target === undefined ? `missing:${selection.modelId}:${selection.profileId}` : JSON.stringify(target)
  const tabInfo = useTabInfo()
  const visible = tabInfo.sidebar.expanded && tabInfo.tab.visible
  const fullscreen = tabInfo.sidebar.fullscreen
  const [status, setStatus] = useState<DesktopPowerShellStatus>('idle')
  const [output, setOutput] = useState('')
  const [failure, setFailure] = useState('')
  const [commandHint, setCommandHint] = useState('')
  const [input, setInput] = useState('')
  const [answering, setAnswering] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [editingConnection, setEditingConnection] = useState(false)
  const [connectionFailure, setConnectionFailure] = useState('')
  const [draft, setDraft] = useState<DesktopSshDraft>(() => connectionDraft(undefined, selection, modelLabel))
  const sessionId = useRef<string>()
  const pendingPassword = useRef('')
  const offset = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const visibilityOwner = useRef(Symbol('desktop-powershell-panel'))
  const pending = view.pending
  const selectionKey = `${selection.modelId}\u0000${selection.profileId}`

  useEffect(() => {
    publishPanelVisibility(visibilityOwner.current, visible)
    return () => { publishPanelVisibility(visibilityOwner.current, false) }
  }, [visible])
  useEffect(() => () => { pendingPassword.current = '' }, [])
  useEffect(() => {
    setActiveConnectionId(undefined)
    setConnectionFailure('')
    if (mode === 'robot' && selection.ssh === undefined) {
      setDraft(connectionDraft(undefined, selection, modelLabel)); setEditingConnection(true)
    }
  }, [mode, modelLabel, selection.ssh, selectionKey])
  useEffect(() => {
    if (!visible) { setStatus('idle'); return }
    if (target === undefined) { setStatus('error'); setFailure(labels.unavailable); setOutput(''); return }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let ownedSession = ''
    setStatus('connecting'); setFailure(''); setCommandHint(''); setOutput(''); offset.current = 0
    let passwordProbe = ''
    const submitPendingPassword = (chunk: string): void => {
      if (pendingPassword.current === '' || ownedSession === '') return
      passwordProbe = `${passwordProbe}${chunk}`.slice(-240)
      if (!hasSshPasswordPrompt(passwordProbe)) return
      const password = pendingPassword.current
      pendingPassword.current = ''
      passwordProbe = ''
      void api.write(ownedSession, `${password}\r`, controller.signal).catch(cause => {
        if (!controller.signal.aborted) { setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed) }
      })
    }
    const poll = async (): Promise<void> => {
      if (controller.signal.aborted || ownedSession === '') return
      try {
        const result = await api.read(ownedSession, offset.current, controller.signal)
        offset.current = result.offset
        if (result.output.length > 0) {
          setOutput(previous => result.truncated ? result.output : `${previous}${result.output}`.slice(-500_000))
          submitPendingPassword(result.output)
        }
        if (result.exited) { pendingPassword.current = ''; setStatus('exited'); return }
      } catch (cause) {
        if (!controller.signal.aborted) { setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed) }
        return
      }
      timer = setTimeout(() => { void poll() }, 120)
    }
    void api.open(target, 120, 32, controller.signal).then(result => {
      if (controller.signal.aborted) { void api.close(result.sessionId).catch(() => {}); return }
      ownedSession = result.sessionId; sessionId.current = result.sessionId; offset.current = result.offset
      setOutput(result.output); setStatus('ready'); submitPendingPassword(result.output); void poll()
      if (target.kind === 'robot') {
        try {
          connections.upsert({
            id: activeProfile?.id ?? `robot:${target.modelId}:${target.profileId}`,
            label: target.label,
            host: target.ssh.host,
            ...(target.ssh.user === undefined ? {} : { user: target.ssh.user }),
            ...(target.ssh.port === undefined ? {} : { port: target.ssh.port }),
            modelId: target.modelId,
            profileId: target.profileId,
            lastConnectedAt: Date.now(),
          })
        } catch (cause) { setConnectionFailure(cause instanceof Error ? cause.message : String(cause)) }
      }
      queueMicrotask(() => { inputRef.current?.focus() })
    }).catch(cause => {
      if (!controller.signal.aborted) {
        pendingPassword.current = ''; setStatus('error'); setFailure(cause instanceof Error ? cause.message : labels.failed)
      }
    })
    return () => {
      controller.abort(); if (timer !== undefined) clearTimeout(timer)
      if (sessionId.current === ownedSession) sessionId.current = undefined
      if (ownedSession !== '') void api.close(ownedSession).catch(() => {})
    }
  }, [api, connections, generation, labels.failed, labels.unavailable, targetKey, visible])

  useEffect(() => {
    if (!visible) return
    const scroll = scrollRef.current
    if (scroll !== null) scroll.scrollTop = scroll.scrollHeight
  }, [output, pending?.key, view.entries, visible])

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
  const submit = (): void => { if (status === 'ready' && input.length > 0) { send(`${input}\r`); setInput(''); setCommandHint('') } }
  const fillCommand = (command: string): void => {
    setInput(command); if (status !== 'ready') setCommandHint(labels.connectFirst)
    queueMicrotask(() => { inputRef.current?.focus() })
  }
  const runCommand = (command: string): void => {
    const value = command.trim()
    if (value.length === 0) return
    if (status === 'ready') { send(`${value}\r`); setCommandHint('') } else fillCommand(value)
  }
  const connectProfile = (profile: DesktopSshProfile): void => {
    pendingPassword.current = ''; setActiveConnectionId(profile.id); setEditingConnection(false)
    setConnectionFailure(''); setGeneration(value => value + 1)
  }
  const editConnection = (profile?: DesktopSshProfile): void => {
    setDraft(connectionDraft(profile, selection, modelLabel)); setConnectionFailure(''); setEditingConnection(true)
  }
  const deleteConnection = (id: string): void => {
    try {
      connections.remove(id)
      if (activeConnectionId === id) { setActiveConnectionId(undefined); setGeneration(value => value + 1) }
    } catch (cause) { setConnectionFailure(cause instanceof Error ? cause.message : String(cause)) }
  }
  const saveConnection = (): void => {
    const port = Number(draft.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) { setConnectionFailure(labels.invalidPort); return }
    connectionSequence += 1
    const id = draft.id || `ssh-${Date.now().toString(36)}-${String(connectionSequence)}`
    const profile: DesktopSshProfile = {
      id, label: draft.label.trim(), host: draft.host.trim(), port,
      ...(draft.user.trim() === '' ? {} : { user: draft.user.trim() }),
      ...(selection.modelId === '' ? {} : { modelId: selection.modelId, profileId: selection.profileId }),
      lastConnectedAt: Date.now(),
    }
    try {
      connections.upsert(profile)
      pendingPassword.current = draft.password
      setDraft(current => ({ ...current, password: '' }))
      setActiveConnectionId(id); setEditingConnection(false); setConnectionFailure('')
      setGeneration(value => value + 1)
    } catch (cause) { setConnectionFailure(cause instanceof Error ? cause.message : String(cause)) }
  }
  const targetTitle = mode === 'local'
    ? labels.local
    : `${labels.robot}${target?.kind === 'robot' ? ` · ${target.label}` : ''}`

  const connectionPane = mode === 'robot' ? <DesktopSshConnectionPane profiles={profiles} activeConnectionId={activeConnectionId}
    target={target} draft={draft} editing={editingConnection} failure={connectionFailure} compact={!fullscreen}
    onConnect={connectProfile} onEdit={editConnection} onDelete={deleteConnection}
    onChange={patch => { setDraft(current => ({ ...current, ...patch })) }} onSubmit={saveConnection}
    onCancel={() => { setEditingConnection(false); setConnectionFailure('') }} /> : null

  return <section className="dshDesktopPowerShellPanel" data-terminal-mode={mode} data-fullscreen={fullscreen || undefined} aria-label={labels.title}>
    {fullscreen && connectionPane}
    <div className="dshDesktopPowerShellSurface">
      <header className="dshDesktopPowerShellHeader"><SquareTerminal aria-hidden="true" /><div><strong>{labels.title}</strong><small>{targetTitle}</small></div>
        <button type="button" aria-label={labels.reconnect} title={labels.reconnect} onClick={() => { setGeneration(value => value + 1) }}><RotateCcw aria-hidden="true" /></button>
      </header>
      {!fullscreen && connectionPane}
      <div className="dshDesktopPowerShellScroll" ref={scrollRef} role="log" aria-live="polite">
        {status === 'connecting' && <p className="dshDesktopPowerShellNotice">{labels.waiting}</p>}
        {status === 'error' && <p className="dshDesktopPowerShellNotice" data-error>{failure || labels.failed}</p>}
        {status === 'exited' && <p className="dshDesktopPowerShellNotice">{labels.exited}</p>}
        {commandHint && <p className="dshDesktopPowerShellNotice">{commandHint}</p>}
        <pre className="dshDesktopPowerShellLiveOutput">{output || (status === 'ready' ? labels.empty : '')}</pre>
        {view.entries.length > 0 && <section className="dshDesktopPowerShellConversationLog"><h3>{labels.modelActivity}</h3>{view.entries.map(entry =>
          <article key={entry.callId}><pre><span>PS&gt; </span>{entry.command}</pre>{entry.output && <pre>{entry.output}</pre>}
            <small data-state={entry.state}>{labels[entry.state]}</small></article>)}</section>}
      </div>
      <form className="dshDesktopPowerShellInput" onSubmit={event => { event.preventDefault(); submit() }}>
        <span>PS&gt;</span><input ref={inputRef} aria-label={labels.input} placeholder={labels.input} value={input}
          onChange={event => { setInput(event.target.value); setCommandHint('') }} />
        <button type="button" disabled={status !== 'ready'} title={labels.interrupt} onClick={() => { send('\u0003') }}>Ctrl+C</button>
        <button type="submit" data-primary disabled={status !== 'ready' || input.length === 0}><Send aria-hidden="true" />{labels.send}</button>
      </form>
      <DesktopTerminalShortcutBar shortcuts={shortcuts} status={status} runCommand={runCommand} fillCommand={fillCommand} />
      {pending !== undefined && <section className="dshDesktopPowerShellApproval" aria-label={labels.approvalTitle}>
        <div className="dshDesktopPowerShellApprovalHeader"><ShieldCheck aria-hidden="true" />{labels.approvalTitle}</div>
        <p>{pending.reason ?? labels.approvalReason}</p>{approvalCommand && <pre>{approvalCommand}</pre>}
      </section>}
      <footer className="dshDesktopPowerShellFooter" aria-label={labels.actions}>
        {renderSlot('desktop.powershell.footer.action', {
          pending, command: approvalCommand, answering, status, target, answer, runCommand, fillCommand,
        })}
      </footer>
    </div>
    </section>
}

export type DesktopPowerShellProps = PropsRuntime<'conversation.session.header.utilities'> & {
  readonly sidebarRight: Pick<ISidebarRight, 'openTab'>
  readonly device: RoboDeviceSelection
}

/** Invisible bridge from the active conversation to the application-level terminal. */
export function DesktopPowerShell({
  device,
  sessionId: activeSessionId,
  sidebarRight,
  useChat,
  useSessionPendingInteraction,
}: DesktopPowerShellProps) {
  const legacy = useChat(snapshot => snapshot.legacy)
  const entries = useMemo(() => collectPowerShellEntries({ legacy }), [legacy])
  const pending = useSessionPendingInteraction(snapshot => {
    const interaction = snapshot.get(activeSessionId)
    return isPowerShellApproval(interaction) ? interaction : undefined
  })
  const selection = useSyncExternalStore(device.subscribe, device.getSnapshot, device.getSnapshot)
  const owner = useRef(Symbol('desktop-powershell-session'))
  useEffect(() => { publishView(owner.current, { entries, ...(pending === undefined ? {} : { pending }) }) }, [entries, pending])
  const runningKey = entries.filter(entry => entry.state === 'running').map(entry => entry.callId).join('|')
  useEffect(() => {
    if (pending === undefined && runningKey.length === 0) return
    sidebarRight.openTab(selection.modelId === '' ? DESKTOP_POWERSHELL_TAB_KIND : DESKTOP_ROBOT_TERMINAL_TAB_KIND)
  }, [pending?.key, runningKey, selection.modelId, sidebarRight])
  useEffect(() => () => { clearView(owner.current) }, [])
  return null
}

/** Compact terminal label used by the right Sidebar tab strip. */
export function DesktopPowerShellTitle({ mode }: { readonly mode: DesktopPowerShellMode }): JSX.Element {
  const labels = copy()
  return <span className="dshDesktopPowerShellTabTitle"><SquareTerminal aria-hidden="true" />
    {mode === 'robot' ? labels.robotTab : labels.localTab}</span>
}

function installCompatibilityPowerShellLauncher(
  navigation: DesktopPowerShellNavigation,
  device: RoboDeviceSelection,
): () => void {
  document.getElementById('dsh-desktop-powershell-root')?.remove()
  const host = document.createElement('div')
  host.id = 'dsh-desktop-powershell-root'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<DesktopPowerShellLauncher navigation={navigation} device={device} />)
  return () => { root.unmount(); host.remove() }
}

/** Mount the Windows launcher, native right-Sidebar tab, and conversation bridge. */
export function applyDesktopPowerShell(
  ctx: Context,
  device: RoboDeviceSelection,
  launcherSurface: 'shell-overlay' | 'document' = 'shell-overlay',
): void {
  ctx.effect(installDesktopPowerShellStyles, 'dsh-plugin-desktop: PowerShell right Sidebar styles')
  const shortcuts = createDesktopTerminalShortcuts()
  const connections = createDesktopSshConnections()
  const navigation = createDesktopPowerShellNavigation()
  ctx.effect(() => () => { shortcuts.dispose() }, 'dsh-plugin-desktop: terminal shortcut storage')
  ctx.effect(() => () => { connections.dispose() }, 'dsh-plugin-desktop: SSH connection storage')
  if (launcherSurface === 'shell-overlay') {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'desktop-powershell-launcher', order: 90,
      inject: () => ({ navigation, device }),
    }, DesktopPowerShellLauncher))
  } else {
    ctx.effect(() => installCompatibilityPowerShellLauncher(navigation, device),
      'dsh-plugin-desktop: compatibility PowerShell launcher')
  }
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], ready => {
    const api = createDesktopPowerShellApi()
    ready.effect(() => navigation.attach(ready.sidebarRight),
      'dsh-plugin-desktop: connect PowerShell launcher navigation')
    for (const mode of ['local', 'robot'] as const) {
      const definition = desktopPowerShellTabDefinition(mode)
      ready.effect(() => ready.sidebarRightTabs.register(definition),
        `dsh-plugin-desktop: ${mode} terminal right Sidebar tab type`)
      ready.effect(() => ready.slots.inject('sidebar.right.pane.tab', () => ready.slots.register({
        name: 'sidebar.right.pane.tab', key: definition.id, inject: () => ({ device, api, mode, shortcuts, connections }),
        children: { 'desktop.powershell.footer.action': { kind: 'list', scope: 'session' } },
      }, DesktopPowerShellPanel)), `dsh-plugin-desktop: ${mode} terminal right Sidebar tab body`)
      ready.effect(() => ready.slots.inject('sidebar.right.pane.tab.title', () => ready.slots.register({
        name: 'sidebar.right.pane.tab.title', key: definition.id, inject: () => ({ mode }),
      }, DesktopPowerShellTitle)), `dsh-plugin-desktop: ${mode} terminal right Sidebar tab title`)
    }
    ready.effect(() => ready.slots.inject('desktop.powershell.footer.action', () => ready.slots.register({
      name: 'desktop.powershell.footer.action', id: 'approval', order: 100,
    }, DesktopPowerShellApprovalActions)), 'dsh-plugin-desktop: PowerShell default footer actions')
    ready.effect(() => ready.slots.inject('conversation.session.header.utilities', () => ready.slots.register({
      name: 'conversation.session.header.utilities', id: 'desktop-powershell-session-bridge', order: 90,
      inject: () => ({ sidebarRight: ready.sidebarRight, device }),
    }, DesktopPowerShell)), 'dsh-plugin-desktop: PowerShell conversation bridge')
  })
}

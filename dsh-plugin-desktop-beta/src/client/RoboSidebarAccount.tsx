import { Dialog } from '@base-ui/react/dialog'
import { Popover } from '@base-ui/react/popover'
import { ChevronUp, Settings, Smartphone, LogOut, UserRound, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoboCodingAccountView } from '../robocoding-account-contract.ts'
import { RoboCodingAccountSection } from './RoboCodingAccountSection.tsx'
import { ROBO_ACCOUNT_CHANGED, type RoboCodingAccountApi } from './robocoding-account-api.ts'

export interface RoboSidebarAccountProps { readonly wide: boolean; readonly api: RoboCodingAccountApi }

export function RoboSidebarAccount({ wide, api }: RoboSidebarAccountProps) {
  const [view, setView] = useState<RoboCodingAccountView>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const revision = useRef(0)
  const panelObserver = useRef<MutationObserver | undefined>(undefined)
  useEffect(() => () => panelObserver.current?.disconnect(), [])
  const [phoneAvailable, setPhoneAvailable] = useState(false)
  const settingsSelector = '[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]'
  const phoneSelector = '[data-slot="sidebar.footer.action"] button[aria-label="手机连接"]'
  useEffect(() => {
    const update = () => setPhoneAvailable(!!document.querySelector(phoneSelector))
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  const openSidebarPanel = useCallback((selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector)
    if (!button || button.getAttribute('aria-expanded') === 'true') return
    setMenuOpen(false)
    // Let the popover release focus before opening the existing panel.
    window.setTimeout(() => {
      panelObserver.current?.disconnect()
      const observer = new MutationObserver(() => {
        if (button.getAttribute('aria-expanded') === 'false') {
          observer.disconnect()
          trigger.current?.focus()
        }
      })
      observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] })
      panelObserver.current = observer
      button.click()
    }, 0)
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ',' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat || event.isComposing) return
      if (!document.querySelector(settingsSelector)) return
      event.preventDefault()
      setAccountOpen(false)
      openSidebarPanel(settingsSelector)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSidebarPanel])
  useEffect(() => {
    let active = true
    let refreshing = false
    const load = async (sync = false) => {
      if (sync && refreshing) return
      if (sync) refreshing = true
      const request = ++revision.current
      try {
        const next = await (sync && view?.state === 'signed_in' ? api.refresh() : api.read())
        if (active && request === revision.current) { setView(next); setError('') }
      } catch {
        if (active && request === revision.current) { setView(undefined); setError('账户暂不可用') }
      } finally { if (sync) refreshing = false }
    }
    const reload = () => { void load() }
    reload()
    window.addEventListener(ROBO_ACCOUNT_CHANGED, reload)
    window.addEventListener('focus', reload)
    const timer = window.setInterval(() => void load(true), view?.state === 'authorizing' ? 2_000 : 30_000)
    return () => { active = false; clearInterval(timer); window.removeEventListener(ROBO_ACCOUNT_CHANGED, reload); window.removeEventListener('focus', reload) }
  }, [api, view?.state, menuOpen, accountOpen])

  const run = async (operation: () => Promise<RoboCodingAccountView>) => {
    setBusy(true); setError(''); ++revision.current
    try { const next = await operation(); ++revision.current; setView(next) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '账户操作失败') }
    finally { setBusy(false) }
  }
  const user = view?.state === 'signed_in' ? view.user : undefined
  const name = user?.displayName || user?.username || '登录账号'
  const balance = user ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(user.balancePoints)} 点` : undefined
  const status = error ? '连接异常' : !view ? '连接中…' : view.state === 'authorizing' ? '等待授权' : view.state === 'unconfigured' ? '服务未连接' : '未登陆'
  const showAccount = () => { setMenuOpen(false); setAccountOpen(true) }

  return <div className="roboSidebarAccount" data-wide={wide}>
    <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Popover.Trigger ref={trigger} className="roboSidebarAccountCard" aria-label={user ? `${name}，${balance}，账户菜单` : `${name}，${status}`}>
        <span className="roboSidebarAvatar" aria-hidden="true">{user ? Array.from(name)[0] : <UserRound size={19} />}</span>
        {wide && <><span className="roboSidebarAccountCopy"><strong>{name}</strong><span>{balance ?? status}</span></span><ChevronUp size={14} aria-hidden="true" /></>}
      </Popover.Trigger>
      <Popover.Portal><Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="roboAccountMenuPositioner">
        <Popover.Popup className="roboAccountMenu" aria-label="账户菜单">
          <Popover.Title className="roboAccountMenuTitle">{user ? name : '我的账号'}</Popover.Title>
          {user && <p className="roboAccountMenuBalance">个人余额 <strong>{balance}</strong></p>}
          {error && <p role="alert" className="roboAccountMenuError">{error}</p>}
          <button type="button" onClick={showAccount}><UserRound size={17} />{user ? '账户管理' : '登录账号'}</button>
          {user && view?.platformUrl && <a href={`${view.platformUrl}/teams`} target="_blank" rel="noopener noreferrer"><Users size={17} />团队管理</a>}
          <div className="roboAccountMenuDivider" />
          <button type="button" onClick={() => openSidebarPanel(settingsSelector)}><Settings size={17} />设置</button>
          {phoneAvailable && <button type="button" onClick={() => openSidebarPanel(phoneSelector)}><Smartphone size={17} />手机连接</button>}
          {user && <><div className="roboAccountMenuDivider" /><button type="button" className="roboAccountMenuLogout" disabled={busy} onClick={() => void run(() => api.logout())}><LogOut size={17} />退出登录</button></>}
        </Popover.Popup>
      </Popover.Positioner></Popover.Portal>
    </Popover.Root>
    <Dialog.Root open={accountOpen} onOpenChange={setAccountOpen}>
      <Dialog.Portal><Dialog.Backdrop className="roboAccountDialogBackdrop" />
        <Dialog.Popup className="roboAccountDialog" finalFocus={trigger}>
          <Dialog.Title className="roboAccountVisuallyHidden">我的账户</Dialog.Title>
          <Dialog.Close className="roboAccountDialogClose" aria-label="关闭账户"><X size={18} /></Dialog.Close>
          <RoboCodingAccountSection api={api} close={() => setAccountOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}

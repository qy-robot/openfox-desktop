import { useEffect, useState } from 'react'
import { Building2, ExternalLink, LogOut, RefreshCw, UserRound, WalletCards } from 'lucide-react'
import type { RoboCodingAccountView, RoboCodingTeamView } from '../robocoding-account-contract.ts'
import type { RoboCodingAccountApi } from './robocoding-account-api.ts'

export interface RoboCodingAccountSectionInjected { readonly api: RoboCodingAccountApi }
export interface RoboCodingAccountSectionProps extends RoboCodingAccountSectionInjected { readonly close?: () => void }

const points = (value: number): string => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
const accountInitial = (name: string): string => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? 'R'
const monthlyRemaining = (team: RoboCodingTeamView): string | undefined => team.monthlyLimitPoints === null
  ? undefined
  : `${points(Math.max(0, team.monthlyLimitPoints - team.monthlyUsedPoints))} 点本月可用`

export function RoboCodingAccountSection({ api }: RoboCodingAccountSectionProps) {
  const [view, setView] = useState<RoboCodingAccountView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [pendingTeamId, setPendingTeamId] = useState<number>()

  const run = async (operation: () => Promise<RoboCodingAccountView>) => {
    setBusy(true)
    setError(undefined)
    try {
      const next = await operation()
      setView(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const next = await api.read()
        if (active) { setView(next) }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    const timer = setInterval(() => { if (active && view?.state === 'authorizing') void load() }, 2_000)
    return () => { active = false; clearInterval(timer) }
  }, [api, view?.state])

  const selectTeam = (team: RoboCodingTeamView) => {
    if (view?.funding.confirmedTeamId === team.id) {
      void run(() => api.selectFunding('team_only', team.id, true))
      return
    }
    setPendingTeamId(team.id)
  }
  const confirmTeam = () => {
    if (pendingTeamId === undefined) return
    const teamId = pendingTeamId
    setPendingTeamId(undefined)
    void run(() => api.selectFunding('team_only', teamId, true))
  }

  const pendingTeam = view?.teams.find(team => team.id === pendingTeamId)
  const teamHref = view?.platformUrl ? `${view.platformUrl}/teams` : undefined

  return <div className="roboAccount">
    <header className="roboAccountPageHeader"><h2>账户</h2></header>

    {error && <p role="alert" className="roboAccountNotice roboAccountNoticeError">{error}</p>}
    {view?.message && !error && <p role="status" className="roboAccountNotice">{view.message}</p>}
    {!view && !error && <p role="status" className="roboAccountLoading">正在连接…</p>}
    {!view && error && <button type="button" disabled={busy} onClick={() => void run(() => api.read())}>重试</button>}

    {(view?.state === 'unconfigured' || view?.state === 'signed_out' || view?.state === 'error') && <section className="roboAccountSignIn">
      <div className="roboAccountSignInMark" aria-hidden="true"><UserRound size={22} strokeWidth={1.8} /></div>
      <div className="roboAccountSignInCopy">
        <h3>OpenFox 官方服务</h3>
        {view.platformUrl === '' && <span className="roboAccountServiceStatus">服务未连接</span>}
      </div>
      <button type="button" className="roboAccountPrimary" disabled={busy || view.platformUrl === ''}
        onClick={() => void run(() => api.login())}>登录官方账号</button>
    </section>}

    {view?.state === 'authorizing' && <section className="roboAccountAuthorization">
      <p>浏览器确认页面已打开，请在页面中确认登录。确认完成后会自动返回。</p>
      <button type="button" disabled={busy} onClick={() => void run(() => api.logout())}>取消登录</button>
    </section>}

    {view?.state === 'signed_in' && view.user && <>
      <section className="roboAccountProfile">
        <div className="roboAccountAvatar" aria-hidden="true">{accountInitial(view.user.displayName)}<span /></div>
        <div className="roboAccountIdentity"><strong title={view.user.displayName}>{view.user.displayName}</strong><span title={view.user.username}>{view.user.username}</span></div>
        <div className="roboAccountBalance"><span>个人点数</span><strong>{points(view.user.balancePoints)} <small>点</small></strong></div>
        <div className="roboAccountActions">
          <button type="button" disabled={busy} onClick={() => void run(() => api.refresh())} aria-label="刷新余额" title="刷新余额"><RefreshCw size={17} /></button>
          <button type="button" disabled={busy} onClick={() => void run(() => api.logout())}><LogOut size={16} />退出</button>
        </div>
      </section>

      <section className="roboAccountPanel">
        <div className="roboAccountSectionTitle"><WalletCards size={18} /><h3>付款来源</h3></div>
        <div className="roboAccountChoices">
          <label className="roboAccountChoice">
            <input type="radio" name="robo-account-funding" value="personal" checked={view.funding.mode === 'personal_only'} disabled={busy}
              onChange={() => { setPendingTeamId(undefined); void run(() => api.selectFunding('personal_only', 0, false)) }} />
            <span><strong>个人点数</strong><small>{points(view.user.balancePoints)} 点可用</small></span>
          </label>
          {view.teams.map(team => <label className="roboAccountChoice" key={team.id}>
            <input type="radio" name="robo-account-funding" value={`team-${team.id}`}
              checked={view.funding.mode === 'team_only' && view.funding.teamId === team.id} disabled={busy}
              onChange={() => selectTeam(team)} />
            <span><strong>{team.name}</strong><small>{points(team.balancePoints)} 点可用{monthlyRemaining(team) ? ` · ${monthlyRemaining(team)}` : ''}</small></span>
          </label>)}
        </div>
        {pendingTeam && <div className="roboAccountConsent" role="alertdialog" aria-labelledby="robo-account-consent-title">
          <div><strong id="robo-account-consent-title">使用“{pendingTeam.name}”的团队点数？</strong><span>仅影响后续新任务；余额不足时不会改用个人点数。</span></div>
          <div><button type="button" disabled={busy} onClick={() => setPendingTeamId(undefined)}>取消</button>
            <button type="button" className="roboAccountPrimary" disabled={busy} onClick={confirmTeam}>确认使用</button></div>
        </div>}
      </section>

      <section className="roboAccountPanel">
        <div className="roboAccountHeading">
          <div className="roboAccountSectionTitle"><Building2 size={18} /><h3>团队</h3></div>
          {teamHref && <a href={teamHref} target="_blank" rel="noopener noreferrer">管理团队<ExternalLink size={14} /></a>}
        </div>
        {view.teams.length === 0 ? <p className="roboAccountEmpty">暂未加入团队</p> : <div className="roboAccountTeamList">
          {view.teams.map(team => <div className="roboAccountTeam" key={team.id}>
            <div><strong>{team.name}</strong><small>{team.role}{team.department ? ` · ${team.department}` : ''}</small></div><span>{points(team.balancePoints)} 点</span>
          </div>)}
        </div>}
      </section>
    </>}
  </div>
}

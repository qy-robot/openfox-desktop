import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsOnboardingOwnerProps, SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RoboCodingAccountView } from '../robocoding-account-contract.ts'
import type { RoboCodingAccountApi } from './robocoding-account-api.ts'

export const ROBO_ONBOARDING_NAMESPACE = 'robocoding-onboarding'
export interface RoboOnboardingSettings { readonly completed: boolean }

export function SkipLegacyOnboarding({ complete }: SettingsOnboardingOwnerProps) {
  useEffect(() => { complete() }, [complete])
  return null
}

export function RoboServiceOnboarding({ complete, openSection, api, scope }: SettingsOnboardingOwnerProps & {
  readonly api: RoboCodingAccountApi
  readonly scope: SettingsScope<RoboOnboardingSettings>
}) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [account, setAccount] = useState<RoboCodingAccountView>()
  const [accountLoaded, setAccountLoaded] = useState(false)
  const [readAttempt, setReadAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const signedInCompletionStarted = useRef(false)
  const completionSent = useRef(false)
  const completeOnce = (): void => {
    if (completionSent.current) return
    completionSent.current = true
    complete()
  }
  const done = settings.value?.completed === true
  useEffect(() => {
    mounted.current = true
    let active = true
    setAccountLoaded(false); setError('')
    void api.read().then(value => { if (active) { setAccount(value); setAccountLoaded(true) } }).catch(() => {
      if (active) { setAccount(undefined); setAccountLoaded(true); setError('暂时无法连接本地账户服务。可以重试，或先进入设置。') }
    })
    return () => { active = false; mounted.current = false }
  }, [api, readAttempt])
  useEffect(() => {
    if (busy) return
    if (done) { completeOnce(); return }
    if (account?.state !== 'signed_in' || signedInCompletionStarted.current) return
    signedInCompletionStarted.current = true
    setBusy(true); setError('')
    void (async () => {
      try {
        if (settings.mode === 'host' && settings.status === 'ready') {
          await scope.set('completed', true)
          if (scope.getSnapshot().value?.completed !== true) throw new Error('首次引导状态未保存，请重试。')
        }
        if (mounted.current) completeOnce()
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : '首次引导状态未保存，请重试。')
      } finally { if (mounted.current) setBusy(false) }
    })()
  }, [busy, done, account?.state, complete, scope, settings.mode, settings.status])
  const visible = !done && accountLoaded && account?.state !== 'signed_in' && settings.status !== 'loading'
  useEffect(() => {
    if (!visible) return
    const root = document.getElementById('root')
    if (!root) return
    const previous = root.inert
    root.inert = true
    return () => { root.inert = previous }
  }, [visible])
  async function finish(section?: string, login = false) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (login && account?.platformUrl) await api.login()
      if (settings.mode === 'host' && settings.status === 'ready') {
        await scope.set('completed', true)
        if (scope.getSnapshot().value?.completed !== true) throw new Error('首次引导状态未保存，请重试。')
      }
      if (!mounted.current) return
      completeOnce()
      if (section) openSection(section)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '暂时无法继续，请重试。')
    } finally { if (mounted.current) setBusy(false) }
  }
  if (!visible) return null
  const officialConfigured = account !== undefined && account.platformUrl !== '' && account.state !== 'unconfigured'
  return <Modal open title="开始使用 RoboCoding" closeLabel="稍后配置" onClose={() => { if (!busy) void finish() }} className="roboServiceWelcome">
    <div className="roboServiceWelcomeBody">
      <button type="button" className="roboServicePrimary" disabled={busy} onClick={() => { void finish('robocoding-account', officialConfigured) }}>
        {busy ? '正在连接…' : officialConfigured ? '登录官方账号' : '配置官方服务'}
      </button>
      <button type="button" className="roboServiceSecondary" disabled={busy} onClick={() => { void finish('models') }}>添加自定义模型</button>
      {error && <div className="roboServiceWelcomeError"><p role="alert">{error}</p><button type="button" disabled={busy} onClick={() => setReadAttempt(value => value + 1)}>重试</button></div>}
    </div>
  </Modal>
}

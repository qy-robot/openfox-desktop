import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createRoboCodingAccountApi } from './robocoding-account-api.ts'
import { ROBO_ONBOARDING_NAMESPACE, RoboServiceOnboarding, SkipLegacyOnboarding, type RoboOnboardingSettings } from './RoboServiceOnboarding.tsx'

export function applyRoboServiceOnboarding(ctx: Context): void {
  const api = createRoboCodingAccountApi()
  const scope = ctx.settingsScope.bind<RoboOnboardingSettings>({
    namespace: ROBO_ONBOARDING_NAMESPACE,
    decode: value => ({ completed: typeof value === 'object' && value !== null && 'completed' in value && value.completed === true }),
  })
  ctx.slots.inject('settings.onboarding', function* () {
    yield ctx.slots.register({ name: 'settings.onboarding', id: 'welcome-notice', priority: -100, order: -100 }, SkipLegacyOnboarding)
    yield ctx.slots.register({ name: 'settings.onboarding', id: 'deepseek-official', priority: -100,
      inject: () => ({ api, scope }),
    }, RoboServiceOnboarding)
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.roboServiceOnboarding = 'true'
    style.textContent = `.roboServiceWelcome{width:min(440px,calc(100vw - 32px));border-radius:18px}.roboServiceWelcomeBody{display:grid;gap:10px;padding-top:2px}.roboServiceWelcomeBody button{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 16px;background:transparent;color:var(--dsw-alias-label-primary);font-weight:600;cursor:pointer;transition:background-color .16s ease,border-color .16s ease,transform .16s ease}.roboServiceWelcomeBody button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-label-secondary)}.roboServiceWelcomeBody button:active:not(:disabled){transform:translateY(1px)}.roboServiceWelcomeBody button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3267d6);outline-offset:2px}.roboServiceWelcomeBody button:disabled{opacity:.5;cursor:wait}.roboServiceWelcomeBody .roboServicePrimary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.roboServiceWelcomeBody .roboServicePrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill);filter:brightness(1.08);border-color:transparent}.roboServiceWelcomeError{display:flex;align-items:center;gap:10px;margin-top:4px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.roboServiceWelcomeError p{flex:1;margin:0;color:var(--dsw-alias-status-error,var(--dsw-alias-label-primary));font-size:13px;line-height:1.45}.roboServiceWelcomeError button{width:auto;flex:none;border:0;padding:4px 2px;background:transparent;font-size:13px}`
    document.head.append(style)
    return () => { style.remove() }
  }, 'RoboCoding: service onboarding styles')
}

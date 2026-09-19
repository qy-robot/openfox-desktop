import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RoboCodingAccountSection } from './RoboCodingAccountSection.tsx'
import { RoboSidebarAccount } from './RoboSidebarAccount.tsx'
import { createRoboCodingAccountApi } from './robocoding-account-api.ts'
import { installRoboCodingAccountStyles } from './robocoding-account-styles.ts'
import { ROBO_SIDEBAR_ACCOUNT_CSS } from './robo-sidebar-account-styles.ts'

export function applyRoboCodingAccount(ctx: ClientContext): void {
  const api = createRoboCodingAccountApi()
  ctx.effect(installRoboCodingAccountStyles, 'dsh-plugin-desktop: OpenFox account styles')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.roboSidebarAccount = 'true'
    style.textContent = ROBO_SIDEBAR_ACCOUNT_CSS
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-plugin-desktop: sidebar account styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'robocoding-account', order: -10, label: () => '我的账户',
    inject: () => ({ api }),
  }, RoboCodingAccountSection))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'robocoding-account', order: 100,
    inject: () => ({ api }),
  }, RoboSidebarAccount))
}

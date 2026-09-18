import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { installRoboBrandStyles, RoboBrandMark, RoboBrandName } from './branding.tsx'

/** Fill the upstream sidebar's documented brand slots without replacing its layout. */
export function applyRoboBranding(ctx: ClientContext): void {
  ctx.effect(installRoboBrandStyles, 'dsh-plugin-desktop: RoboCoding brand styles')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -100 }, RoboBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -100 }, RoboBrandName)
    }))
}

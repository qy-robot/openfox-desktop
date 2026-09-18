import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { RoboModelsSection } from './RoboModelsSection.tsx'
import { createRoboModelsApi } from './robo-models-api.ts'
import { installRoboModelsStyles } from './robo-models-styles.ts'
import { createRoboCodingAccountApi } from './robocoding-account-api.ts'

/** Replace the upstream provider catalog with RoboCoding official-first model settings. */
export function applyRoboModels(ctx: ClientContext): void {
  const api = createRoboModelsApi(ctx)
  const accountApi = createRoboCodingAccountApi()
  ctx.effect(installRoboModelsStyles, 'dsh-plugin-desktop: RoboCoding models styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'models', order: 9, priority: -100, label: () => '模型服务',
    inject: () => ({ api, accountApi }),
  }, RoboModelsSection))
}

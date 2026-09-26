import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { Bot, Store } from 'lucide-react'
import { RoboDeviceWorkbench } from './RoboDeviceWorkbench.tsx'
import type { RoboDeviceSelection } from './robo-device-selection.ts'
import { RoboSkillMarket } from './RoboSkillMarket.tsx'
import { createRoboHostSkillLibrary } from './robo-skills-library.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createRoboSkillsApi } from './robo-skills-api.ts'
import { createRoboSkillSession, type RoboSkillSession } from './robo-skills-state.ts'
import { RoboSkillPicker, type RoboSkillPickerProps } from './RoboSkillPicker.tsx'
import { installRoboSkillsStyles } from './robo-skills-styles.ts'

/** Company skills use a Desktop-owned command; the upstream local /skill source remains independent. */
export function applyRoboSkills(ctx: Context, device: RoboDeviceSelection): void {
  const api = createRoboSkillsApi()
  const library = createRoboHostSkillLibrary(ctx.settingsScope.bind<{ skillIds: readonly string[] }>({ namespace: 'robocoding-skill-library' }))
  const marketId = 'robo-skills-market' as MainPanelId
  const devicesId = 'robo-robots' as MainPanelId
  const openMarket = () => { ctx.layout.selectPanel(marketId) }
  const openDevices = () => { ctx.layout.selectPanel(devicesId) }
  ctx.effect(() => () => { library.dispose() }, 'robo-skills: release persisted choices')
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: marketId },
    () => <RoboSkillMarket api={api} library={library} device={device} close={() => { ctx.layout.selectPanel(null) }} />))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: devicesId },
    () => <RoboDeviceWorkbench api={api} selection={device} close={() => { ctx.layout.selectPanel(null) }} openMarket={openMarket} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: marketId, label: '技能市场', order: 40,
  }, ({ size }: { size: number }) => <Store size={size} aria-hidden="true" />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: devicesId, label: '设备', order: 41,
  }, ({ size }: { size: number }) => <Bot size={size} aria-hidden="true" />))
  const sessions = new Map<SessionId, RoboSkillSession>()
  function sessionFor(id: SessionId): RoboSkillSession {
    const existing = sessions.get(id)
    if (existing) return existing
    const scope = ctx.sessions.scope(id)
    if (!scope) throw new Error('技能选择器找不到当前会话')
    const session = createRoboSkillSession(api, ctx.conversation.input.for(scope), scope, library)
    sessions.set(id, session)
    scope.effect(() => () => { session.dispose(); sessions.delete(id) }, 'robo-skills: release session')
    return session
  }
  ctx.effect(installRoboSkillsStyles, 'robo-skills: theme styles')
  ctx.effect(() => () => { for (const session of sessions.values()) session.dispose(); sessions.clear() }, 'robo-skills: release plugin')
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'robo-skills', order: 50,
    inject: id => ({ api, session: sessionFor(id), library, device, openMarket, openDevices }),
  }, ({ sessionId, ...props }: RoboSkillPickerProps & { sessionId: SessionId }) => <RoboSkillPicker key={sessionId} {...props} />))
}

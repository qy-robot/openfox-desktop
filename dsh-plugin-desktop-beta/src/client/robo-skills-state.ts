/** Per-session demo invocation through the existing composer command contract. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RoboSkillLibrary } from './robo-skills-library.ts'
import type { RoboResult, RoboSelection, RoboSkill, RoboSkillsApi } from './robo-skills-api.ts'

export const ROBO_SKILL_TOKEN = '/技能 '
export interface RoboSkillState {
  readonly selection?: RoboSelection | undefined; readonly skill?: RoboSkill | undefined
  readonly modelId: string; readonly profileId: string
  readonly result?: RoboResult | undefined; readonly error?: string | undefined; readonly running: boolean
}
export function createRoboSkillSession(api: RoboSkillsApi, input: SessionInput, actx: Context, library: RoboSkillLibrary) {
  // Match DesktopLayoutState's small immutable snapshot contract. The published
  // upstream store requires undeclared Zustand runtime dependencies.
  let snapshot: RoboSkillState = { modelId: '', profileId: '', running: false }
  const listeners = new Set<() => void>()
  const store = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(value: RoboSkillState) {
      snapshot = Object.freeze(value)
      for (const listener of listeners) listener()
    },
  }
  let active = true
  let runController: AbortController | undefined
  const update = (patch: Partial<RoboSkillState>) => { if (active) store.set({ ...store.getSnapshot(), ...patch }) }
  const off = input.state.subscribe(() => {
    const current = input.state.getSnapshot()
    if (store.getSnapshot().selection && current.phase !== 'submitting' && current.claim?.token !== ROBO_SKILL_TOKEN) {
      // View teardown releases the upstream claim before it drops the scoped
      // event listener. Consume our owned prefix synchronously so a remount can
      // never present a selected chip whose Enter path is plain/default submit.
      if (current.phase === 'plain' && current.draft.startsWith(ROBO_SKILL_TOKEN)) {
        actx.bail(actx, 'slash/input-consume-token', {
          guard: { kind: 'span', span: { start: 0, end: ROBO_SKILL_TOKEN.length, draftRev: current.draftRev } },
        })
      }
      update({ selection: undefined, skill: undefined, error: undefined })
    }
  })
  const session = {
    store,
    select(skill: RoboSkill, selection: RoboSelection): boolean {
      if (!library.getSnapshot().includes(skill.id)) return false
      const current = input.state.getSnapshot()
      if (current.phase === 'submitting' || current.phase === 'adjudicating'
        || (current.claim && current.claim.token !== ROBO_SKILL_TOKEN)) return false
      const end = current.claim?.token === ROBO_SKILL_TOKEN ? ROBO_SKILL_TOKEN.length : 0
      const accepted = input.beginCommand({ token: ROBO_SKILL_TOKEN,
        hint: `本地示例 · ${skill.displayName} · 仅分析文本，不调用模型或设备`,
        attachments: false,
        async submit(text) {
          if (!library.getSnapshot().includes(skill.id)) return { kind: 'error', text: '此技能已从我的技能中移除，请先在技能市场添加' }
          if (!text.trim()) return { kind: 'error', text: '请输入要分析的示例文本' }
          if (text.length > 16000) return { kind: 'error', text: '示例输入最多 16000 个字符' }
          runController = new AbortController()
          update({ running: true, result: undefined, error: undefined })
          try {
            const result = await api.run(selection, text, runController.signal)
            update({ running: false, selection: undefined, skill: undefined, result })
            return { kind: 'success', text: '本地示例分析完成，结果已显示在技能面板' }
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : '本地示例分析失败，请重试'
            update({ running: false, error: message })
            return { kind: 'error', text: message }
          } finally { runController = undefined }
        },
      }, { start: 0, end, draftRev: current.draftRev })
      if (accepted) update({ selection, skill, modelId: selection.modelId ?? store.getSnapshot().modelId, profileId: selection.profileId ?? store.getSnapshot().profileId,
        result: undefined, error: undefined })
      return accepted
    },
    selectLocal(name: string): boolean {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return false
      const before = input.state.getSnapshot()
      if (before.phase === 'submitting' || before.phase === 'adjudicating'
        || (before.claim && before.claim.token !== ROBO_SKILL_TOKEN)) return false
      session.remove()
      const current = input.state.getSnapshot()
      if (current.draft.trimStart().startsWith('/')) return false
      return actx.bail(actx, 'slash/input-insert-text', {
        text: `/${name} `,
        span: { start: 0, end: 0, draftRev: current.draftRev },
      }) === true
    },
    remove(): void {
      const current = input.state.getSnapshot()
      // Selection is the ownership proof that permits removing the exact
      // prefix; manually authored `/技能 ` text has no selection and is kept.
      if (!store.getSnapshot().selection || !current.draft.startsWith(ROBO_SKILL_TOKEN)
        || current.phase === 'submitting' || current.phase === 'adjudicating') return
      actx.bail(actx, 'slash/input-consume-token', {
        guard: { kind: 'span', span: { start: 0, end: ROBO_SKILL_TOKEN.length, draftRev: current.draftRev } },
      })
    },
    dismissResult(): void { update({ result: undefined, error: undefined }) },
    dispose(): void {
      if (!active) return
      if (!store.getSnapshot().running) session.remove()
      active = false; off(); offLibrary(); runController?.abort(); listeners.clear()
    },
  }
  const offLibrary = library.subscribe(() => {
    const current = store.getSnapshot()
    if (current.selection && !current.running && !library.getSnapshot().includes(current.selection.skillId)) session.remove()
  })
  return session
}
export type RoboSkillSession = ReturnType<typeof createRoboSkillSession>

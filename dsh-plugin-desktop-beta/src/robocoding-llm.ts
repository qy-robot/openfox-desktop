import type { Context } from '@deepseek-ai/cordis'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { RoboCodingRelayCredential } from './robocoding-platform.ts'

const PROVIDER = 'robocoding'

// Zhipu GLM rejects max_tokens above 131072 with INVALID_REQUEST; without a
// catalog cap every request falls back to the adapter's 256000 default and
// the whole message fails.
const GLM_OUTPUT_TOKENS_CAP = 131_072

function officialModelEntry(id: string): { id: string, name: string, maxTokens?: number } {
  return { id, name: id, ...id.startsWith('glm-') ? { maxTokens: GLM_OUTPUT_TOKENS_CAP } : {} }
}

class RoboCodingAdapter extends DeepSeekAdapter {
  override providerInfo(provider: string) { return { id: provider, name: 'OpenFox' } }
}

export class RoboCodingLlmRegistration {
  private sequence = 0
  private activated = false
  private current: { readonly ref: string; readonly relay: RoboCodingRelayCredential; readonly models: readonly string[] } | undefined
  private readonly credentials = new Map<string, string>()
  private readonly adapter: DeepSeekAdapter
  private registration: ReturnType<Context['llm']['registerAdapter']> | undefined

  constructor(private readonly ctx: Context) {
    let userId: ReturnType<typeof getOrCreateAnonymousUserId> | undefined
    this.adapter = new RoboCodingAdapter({
      options: () => {
        const current = this.current
        if (current === undefined) return resolveAdapterOptions({
          baseURL: 'https://unconfigured.invalid', apiKeyEnv: 'ROBOCODING_SIGN_IN_REQUIRED', models: [],
        })
        return resolveAdapterOptions({ baseURL: current.relay.baseUrl, apiKeyEnv: current.ref,
          models: current.models.map(officialModelEntry) })
      },
      resolveApiKey: async connection => {
        const key = this.credentials.get(connection.apiKeyEnv)
        if (key === undefined) throw new Error('请先登录 OpenFox，或刷新账户后重试')
        return key
      },
      resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
        attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
      ),
      prepareExtensions: request => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    })
  }

  async update(relay: RoboCodingRelayCredential, models: readonly string[]): Promise<void> {
    const sameFunding = this.current?.relay.fundingMode === relay.fundingMode && this.current.relay.teamId === relay.teamId
    const ref = sameFunding && this.current !== undefined ? this.current.ref : `ROBOCODING_RELAY_${String(++this.sequence)}`
    if (!sameFunding) { this.credentials.clear(); credentialRef(ref) }
    this.credentials.set(ref, relay.key)
    this.current = { ref, relay, models: [...models] }
    if (models.length === 0) {
      this.registration?.()
      this.registration = undefined
    } else if (this.registration === undefined) {
      this.registration = this.ctx.llm.registerAdapter([PROVIDER], this.adapter)
    } else {
      this.registration.replace([PROVIDER])
    }
    const defaultModel = this.ctx.get('agentDefaultModel')
    const selection = defaultModel?.currentSelection()
    const saved = this.ctx.get('settings')?.describe({ redactSecrets: true }).find(entry => entry.ns === 'agent-default-model')?.user
    const hasSavedSelection = typeof saved === 'object' && saved !== null
      && 'provider' in saved && typeof saved.provider === 'string'
      && 'model' in saved && typeof saved.model === 'string'
    if (models[0] !== undefined && ((!this.activated && !hasSavedSelection)
      || (selection?.provider === PROVIDER && !models.includes(selection.model)))) {
      await defaultModel?.saveSelection({ provider: PROVIDER, model: models[0] })
    }
    if (models.length > 0) this.activated = true
  }

  async updateModels(models: readonly string[]): Promise<void> {
    const current = this.current
    if (current === undefined) return
    if (current.models.length === models.length && current.models.every((id, index) => id === models[index])) return
    await this.update(current.relay, models)
  }

  clear(): void {
    this.credentials.clear()
    this.current = undefined
    this.registration?.()
    this.registration = undefined
  }

  dispose(): void {
    this.credentials.clear()
    this.current = undefined
    this.registration?.()
    this.registration = undefined
  }
}

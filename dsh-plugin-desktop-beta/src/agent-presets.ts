/** Desktop sessions default to the single product mode, independent of legacy preferences. */
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

export default class DesktopAgentPresets extends AgentPresets {
  /** Keep explicit historical preset ids readable when resuming existing sessions. */
  override get defaultId(): string {
    return 'standard'
  }
}

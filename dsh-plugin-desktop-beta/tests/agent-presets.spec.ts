import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { expect, it } from 'vitest'
import DesktopAgentPresets from '../src/agent-presets.ts'

it('uses standard despite persisted or subsequently changed legacy defaults, preserving historical resolution', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-standard-preset-'))
  const ctx = new Context()
  try {
    const path = join(home, 'settings.yaml')
    await writeFile(path, 'agent-presets:\n  default: ptc\n')
    ctx.baseUrl = new URL('../package.json', import.meta.url).href
    await ctx.plugin(Loader)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(FileSettingsProvider, { path, watch: false })
    await ctx.plugin(DesktopAgentPresets, {
      default: 'minimal', roots: [], includeShippedRoot: true, includeUserRoot: false,
    })
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
    await ctx.settings.update('agent-presets', { default: 'cordis' })
    expect((await ctx.agentPresets.resolve()).id).toBe('standard')
    expect((await ctx.agentPresets.resolve('ptc')).id).toBe('ptc')
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

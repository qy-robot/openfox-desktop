import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createRoboCloudSkillProvider, installRoboCloudSkills } from '../src/robo-cloud-skills.ts'

describe('RoboCoding cloud skill provider', () => {
  it('publishes the selected cloud skill as a host-resolvable definition', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      skills: [{
        id: 'cloud-diagnostics',
        displayName: '云端诊断',
        description: '分析设备诊断信息',
        version: '1.2.0',
        details: {
          overview: '识别诊断线索',
          inputs: ['日志文本'],
          outputs: ['只读诊断结论'],
          limitations: ['不执行设备操作'],
        },
      }],
    }), { status: 200 })) as typeof fetch
    const provider = createRoboCloudSkillProvider({ fetch: fetcher, catalogUrl: 'https://skills.test/catalog' })
    const observation = await provider.list({ signal: new AbortController().signal })
    const candidates = 'candidates' in observation ? observation.candidates : observation
    const bumi = candidates.find(candidate => candidate.name === 'bumi-sdk-development')
    const remote = candidates.find(candidate => candidate.name === 'cloud-diagnostics')

    expect(fetcher).toHaveBeenCalledWith('https://skills.test/catalog', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json' },
    }))
    expect(bumi).toBeDefined()
    expect(remote?.description).toBe('分析设备诊断信息')
    const definition = await provider.get(bumi!, {})
    expect(definition?.content).toContain('RoboCoding 云端技能')
    expect(definition?.content).toContain('不要搜索本地同名目录')
    expect(definition?.content).toContain('不要声称“看不到该 skill”')
  })

  it('keeps Bumi discoverable when the public catalog is unavailable', async () => {
    const provider = createRoboCloudSkillProvider({
      fetch: vi.fn(async () => { throw new Error('catalog unavailable') }) as typeof fetch,
    })
    const observation = await provider.list({})
    const candidates = 'candidates' in observation ? observation.candidates : observation
    expect(candidates.map(candidate => candidate.name)).toContain('bumi-sdk-development')
  })

  it('does not expose a legacy review placeholder as the selected Bumi contract', async () => {
    const provider = createRoboCloudSkillProvider({
      fetch: vi.fn(async () => new Response(JSON.stringify({
        skills: [{
          id: 'bumi-sdk-development',
          displayName: 'Bumi SDK 开发助手',
          description: '已从受控 GitHub 仓库导入，待审核补充公开简介。',
          version: '0.2.1',
          details: {
            overview: '该 Skill 已从受控 GitHub 仓库导入，需经员工审核后才可上线。',
            inputs: ['审核后补充。'],
            outputs: ['审核后补充。'],
            limitations: ['审核后补充。'],
          },
        }],
      }), { status: 200 })) as typeof fetch,
    })
    const observation = await provider.list({})
    const candidates = 'candidates' in observation ? observation.candidates : observation
    const bumi = candidates.find(candidate => candidate.name === 'bumi-sdk-development')!
    expect(bumi.description).toBe('检查 Bumi SDK 项目说明、DDS 配置线索和报错文本，仅生成只读预检结果。')
    expect((await provider.get(bumi, {}))?.content).not.toContain('待审核')
  })

  it('registers the bridge in the host Skill Registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ skills: [] }), { status: 200 })))
    try {
      const dispose = installRoboCloudSkills(ctx)
      const definition = await ctx.skills.get('bumi-sdk-development')
      expect(definition?.provider).toBe('robocoding-cloud')
      expect(definition?.content).toContain('/bumi-sdk-development')
      dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

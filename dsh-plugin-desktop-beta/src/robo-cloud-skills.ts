/** Host-side bridge for published OpenFox skills.
 *
 * The renderer's Robo skill catalog intentionally exposes public metadata only.
 * This provider gives the Host skill registry the same public contract, so a
 * selected `/skill-name` is a real Host skill invocation instead of plain text
 * that the model tries to resolve from ~/.claude/skills.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider, SkillRegistry } from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'robocoding-cloud'
const PROVIDER_RANK = 250
const CATALOG_URL = 'https://api.openfox.work/api/catalog'
const MAX_RESPONSE_BYTES = 1_048_576
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

interface PublicCloudSkill {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly summary?: string
  readonly version?: string
  readonly details?: {
    readonly overview?: string
    readonly inputs?: readonly string[]
    readonly outputs?: readonly string[]
    readonly limitations?: readonly string[]
  }
}

interface CloudSkillOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly catalogUrl?: string
}

const FALLBACK_BUMI: PublicCloudSkill = {
  id: 'bumi-sdk-development',
  displayName: 'Bumi SDK 开发助手',
  description: '检查 Bumi SDK 项目说明、DDS 配置线索和报错文本，仅生成只读预检结果。',
  summary: '检查 Bumi SDK 环境与诊断线索。',
  version: '0.2.1',
  details: {
    overview: '识别 Bumi SDK、DDS、Python 入口和风险操作线索。',
    inputs: ['用户提供的 SDK、DDS 或报错文本'],
    outputs: ['环境线索和待确认项'],
    limitations: ['不会执行命令、修改文件、连接 DDS 或控制机器人'],
  },
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Legacy GitHub imports used lifecycle copy as public metadata.  That copy is
 * not a capability description and must not replace the bundled public
 * contract after a skill has been selected.
 */
function isPlaceholderPublicSkill(skill: PublicCloudSkill): boolean {
  const values = [
    skill.description,
    skill.summary,
    skill.details?.overview,
    ...(skill.details?.inputs ?? []),
    ...(skill.details?.outputs ?? []),
    ...(skill.details?.limitations ?? []),
  ].filter(nonEmptyString)
  return values.some(value => /待审核|审核后补充|才可上线|待员工审核|pending review|awaiting review|not yet published/iu.test(value))
}

function parseCatalog(value: unknown): PublicCloudSkill[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const raw = value as { skills?: unknown }
  if (!Array.isArray(raw.skills)) return []
  return raw.skills.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const skill = item as Record<string, unknown>
    if (!nonEmptyString(skill.id) || !SKILL_NAME.test(skill.id)
      || !nonEmptyString(skill.displayName) || !nonEmptyString(skill.description)) return []
    const details = skill.details && typeof skill.details === 'object' && !Array.isArray(skill.details)
      ? skill.details as Record<string, unknown> : undefined
    const strings = (field: unknown): readonly string[] | undefined => {
      if (!Array.isArray(field)) return undefined
      const values = field.filter(nonEmptyString).slice(0, 20)
      return values.length ? values : undefined
    }
    const overview = details === undefined || !nonEmptyString(details.overview) ? undefined : details.overview
    const inputs = details === undefined ? undefined : strings(details.inputs)
    const outputs = details === undefined ? undefined : strings(details.outputs)
    const limitations = details === undefined ? undefined : strings(details.limitations)
    return [{
      id: skill.id,
      displayName: skill.displayName,
      description: skill.description,
      ...(nonEmptyString(skill.summary) ? { summary: skill.summary } : {}),
      ...(nonEmptyString(skill.version) ? { version: skill.version } : {}),
      ...(details === undefined ? {} : {
        details: {
          ...(overview === undefined ? {} : { overview }),
          ...(inputs === undefined ? {} : { inputs }),
          ...(outputs === undefined ? {} : { outputs }),
          ...(limitations === undefined ? {} : { limitations }),
        },
      }),
    }]
  })
}

function skillContent(skill: PublicCloudSkill): string {
  const details = skill.details
  const lines = [
    `你正在使用 OpenFox 云端技能「${skill.displayName}」（/${skill.id}）。`,
    '这是已发布的 OpenFox 云端技能契约，不是本机 ~/.claude/skills 下的本地技能。不要搜索本地同名目录来判断它是否存在。',
    `技能版本：${skill.version ?? '以云端目录为准'}`,
    `能力说明：${details?.overview ?? skill.summary ?? skill.description}`,
  ]
  if (details?.inputs?.length) lines.push(`输入：${details.inputs.join('；')}`)
  if (details?.outputs?.length) lines.push(`输出：${details.outputs.join('；')}`)
  if (details?.limitations?.length) lines.push(`限制：${details.limitations.join('；')}`)
  lines.push(
    '优先依据这份云端技能契约回答当前用户请求；不要声称“看不到该 skill”。',
    '涉及命令、文件修改、部署、设备连接或运动控制时，只能给出只读分析和待审批建议，除非会话明确提供了对应的安全工具并获得授权。',
  )
  return lines.join('\n')
}

function toDefinition(skill: PublicCloudSkill): SkillDefinition {
  return {
    name: skill.id,
    description: skill.description,
    ...(skill.details?.overview ? { whenToUse: skill.details.overview } : {}),
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'opaque', description: 'OpenFox 云端技能服务' },
    content: skillContent(skill),
  }
}

function toCandidate(skill: PublicCloudSkill): SkillCandidate {
  const definition = toDefinition(skill)
  return { ...definition, rank: PROVIDER_RANK, locator: definition }
}

async function fetchCloudSkills(options: CloudSkillOptions, signal: AbortSignal | undefined): Promise<PublicCloudSkill[]> {
  const fetcher = options.fetch ?? globalThis.fetch
  if (fetcher === undefined) return []
  try {
    const response = await fetcher(options.catalogUrl ?? CATALOG_URL, {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return []
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return []
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return []
    return parseCatalog(JSON.parse(text))
  } catch (error) {
    if (signal?.aborted) throw error
    return []
  }
}

export function createRoboCloudSkillProvider(options: CloudSkillOptions = {}): SkillProvider {
  return {
    name: PROVIDER_NAME,
    async list({ signal }) {
      const remote = await fetchCloudSkills(options, signal)
      const skills = new Map<string, PublicCloudSkill>([[FALLBACK_BUMI.id, FALLBACK_BUMI]])
      for (const skill of remote) {
        // Keep the stable public contract when the service still exposes the
        // old “review first, fill in later” placeholder snapshot.  The model
        // should never turn that stale projection into a false pending state.
        if (skill.id === FALLBACK_BUMI.id && isPlaceholderPublicSkill(skill)) continue
        skills.set(skill.id, skill)
      }
      return [...skills.values()].map(toCandidate)
    },
    async get(candidate) {
      return candidate.locator as SkillDefinition
    },
  }
}

/** Register the bridge when the Desktop composition mounts the Host skill registry. */
export function installRoboCloudSkills(ctx: Context): () => void {
  const registry = ctx.get('skills') as SkillRegistry | undefined
  if (registry === undefined) return () => {}
  return registry.registerProvider(() => createRoboCloudSkillProvider())
}

import { publicDeviceDetails, publicPublisher, type RoboDeviceDetails, type RoboPublisher } from '../robo-catalog-metadata.ts'
/** Public metadata only; private skill definitions stay on the local service. */
export interface RoboComponent { readonly version: string; readonly scheme?: 'exact' | 'semver' }
export interface RoboProfile extends RoboDeviceDetails {
  readonly id: string; readonly label: string
  readonly components: Readonly<Record<string, RoboComponent>>
}
export interface RoboRobot extends RoboDeviceDetails {
  readonly id: string; readonly displayName: string; readonly manufacturer: string
  /** Stable human-facing model name; older catalogs may omit it and fall back to displayName. */
  readonly model?: string
  readonly family: string; readonly seriesId?: string; readonly profiles: readonly RoboProfile[]
}
export interface RoboSkillDetails {
  readonly overview: string; readonly inputs: readonly string[]; readonly outputs: readonly string[]
  readonly limitations: readonly string[]
}
export interface RoboSkill {
  readonly id: string; readonly displayName: string; readonly summary: string
  /** Public, square-cropped icon data URL. Private skill content never belongs here. */
  readonly icon?: string
  readonly version: string; readonly category: string; readonly robotIndependent: boolean
  readonly targets: readonly { readonly modelId: string; readonly profileIds: readonly string[] }[]
  readonly demo: boolean
  readonly execution: 'local-demo' | 'local-readonly' | 'server'
  readonly publisher?: RoboPublisher
  readonly details?: RoboSkillDetails
  readonly compatibility?: RoboCompatibility
  readonly compatibilitySummary?: { readonly status: 'universal' | 'targeted' | 'mismatch' | 'unknown'; readonly selectableProfiles: number }
}
/**
 * Only skills in this allowlist may use a bundled, read-only preflight runner.
 * The optional server marker is carried for observability and future runners;
 * the fixed client allowlist keeps older published catalogs safe to consume.
 */
const LOCAL_READONLY_SKILL_IDS = new Set(['bumi-sdk-development'])
export function isRoboSkillRunnable(skill: Pick<RoboSkill, 'id' | 'demo' | 'execution'>): boolean {
  return skill.demo || LOCAL_READONLY_SKILL_IDS.has(skill.id)
}
export type RoboCompatibilityScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'series'; readonly seriesIds: readonly string[] }
  | { readonly kind: 'models'; readonly modelIds: readonly string[] }
  | { readonly kind: 'profiles'; readonly targets: readonly { readonly modelId: string; readonly profileId: string }[] }
export type RoboCompatibilityRequirement =
  | { readonly componentId: string; readonly scheme: 'exact' | 'semver'; readonly operator: 'exact'; readonly value: string }
  | { readonly componentId: string; readonly scheme: 'exact' | 'semver'; readonly operator: 'in'; readonly values: readonly string[] }
  | { readonly componentId: string; readonly scheme: 'semver'; readonly operator: 'range'; readonly min?: string; readonly minInclusive: boolean; readonly max?: string; readonly maxInclusive: boolean; readonly allowPrerelease: boolean }
export interface RoboCompatibilityRule { readonly scope: RoboCompatibilityScope; readonly requirements: readonly RoboCompatibilityRequirement[] }
export interface RoboCompatibility {
  readonly compatibilitySchemaVersion: 2
  readonly rules: readonly RoboCompatibilityRule[]
  readonly exclusions: readonly RoboCompatibilityRule[]
  readonly testedTargets: readonly { readonly modelId: string; readonly profileId: string; readonly result: 'passed' | 'failed'; readonly testedAt: string }[]
}
export interface RoboCatalog {
  readonly schemaVersion: 1; readonly mode: 'local-demo' | 'catalog'
  readonly marketRevision?: number
  readonly featuredSkillIds: readonly string[]
  readonly categories: readonly { readonly id: string; readonly name: string; readonly visible: boolean }[]
  readonly robots: readonly RoboRobot[]; readonly skills: readonly RoboSkill[]
}
export interface RoboSelection {
  readonly skillId: string; readonly skillVersion: string
  readonly modelId?: string; readonly profileId?: string
}
export interface RoboBumiFinding {
  readonly area: 'environment' | 'python' | 'cpp' | 'dds' | 'vision' | 'deployment' | 'motion-safety' | 'documentation'
  readonly level: 'observed' | 'needs-confirmation' | 'risk' | 'blocked'
  readonly message: string; readonly evidence: string
}
export interface RoboBumiOutput {
  readonly status: 'ready-for-review' | 'ready-for-authorized-validation' | 'needs-investigation' | 'blocked'
  readonly summary: string; readonly findings: readonly RoboBumiFinding[]
  readonly filePatchProposals: readonly { readonly targetPath: string; readonly purpose: string; readonly changeSummary: string; readonly approvalRequired: true }[]
  readonly commandProposals: readonly { readonly command: string; readonly purpose: string; readonly expectedResult: string; readonly stopCondition: string; readonly approvalRequired: true }[]
  readonly deviceOperationProposals: readonly { readonly operation: 'ssh-readonly-check' | 'file-transfer-plan' | 'dds-connectivity-check' | 'camera-validation' | 'motion-capable-run'; readonly purpose: string; readonly preconditions: readonly string[]; readonly stopCondition: string; readonly approvalRequired: true }[]
  readonly safetyNotes: readonly string[]
}
export interface RoboResult {
  readonly mode: 'local-demo'; readonly demo: true
  readonly skillId: string; readonly skillVersion: string; readonly summary: string
  readonly findings: readonly { readonly level: 'info' | 'warning'; readonly message: string }[]
  readonly bumi?: RoboBumiOutput
}
export interface RoboSkillsApi {
  catalog(signal?: AbortSignal): Promise<RoboCatalog>
  devices(signal?: AbortSignal): Promise<RoboCatalog>
  run(selection: RoboSelection, text: string, signal?: AbortSignal): Promise<RoboResult>
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('技能服务返回了无效数据')
  return value as Record<string, unknown>
}
function string(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('技能服务返回了无效文本')
  return value
}
function icon(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 400_000
    || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error('技能图标格式无效')
  }
  return value
}
function array(value: unknown, max = 2000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('技能目录超出支持范围')
  return value as unknown[]
}
function unique(items: readonly { readonly id: string }[]): void {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('技能目录存在重复标识')
}
function parseRoboSkillDetails(value: unknown): RoboSkillDetails {
  const r = record(value)
  const texts = (value: unknown) => array(value, 20).map(item => string(item, 2048))
  return { overview: string(r.overview, 4096), inputs: texts(r.inputs), outputs: texts(r.outputs),
    limitations: texts(r.limitations) }
}
function parseComponents(value: unknown): Readonly<Record<string, RoboComponent>> {
  if (value === undefined) return {}
  const raw = record(value)
  return Object.fromEntries(Object.entries(raw).map(([id, item]) => {
    const component = record(item)
    if (component.scheme !== undefined && component.scheme !== 'exact' && component.scheme !== 'semver') throw new Error('无效设备组件版本')
    return [string(id, 128), { version: string(component.version, 128), ...(component.scheme === undefined ? {} : { scheme: component.scheme }) }]
  }))
}
function parseCompatibilityScope(value: unknown): RoboCompatibilityScope {
  const scope = record(value)
  if (scope.kind === 'all') return { kind: 'all' }
  if (scope.kind === 'series') return { kind: 'series', seriesIds: array(scope.seriesIds, 100).map(id => string(id, 128)) }
  if (scope.kind === 'models') return { kind: 'models', modelIds: array(scope.modelIds, 100).map(id => string(id, 129)) }
  if (scope.kind === 'profiles') return { kind: 'profiles', targets: array(scope.targets, 100).map(item => {
    const target = record(item); return { modelId: string(target.modelId, 129), profileId: string(target.profileId, 128) }
  }) }
  throw new Error('无效技能适配范围')
}
function parseCompatibilityRequirement(value: unknown): RoboCompatibilityRequirement {
  const requirement = record(value)
  const componentId = string(requirement.componentId, 128)
  if (requirement.scheme !== 'exact' && requirement.scheme !== 'semver') throw new Error('无效组件版本方案')
  if (requirement.operator === 'exact') return { componentId, scheme: requirement.scheme, operator: 'exact', value: string(requirement.value, 128) }
  if (requirement.operator === 'in') return { componentId, scheme: requirement.scheme, operator: 'in', values: array(requirement.values, 100).map(item => string(item, 128)) }
  if (requirement.operator === 'range' && requirement.scheme === 'semver') {
    const min = requirement.min === undefined ? undefined : string(requirement.min, 128)
    const max = requirement.max === undefined ? undefined : string(requirement.max, 128)
    if (!min && !max) throw new Error('无效组件版本范围')
    return { componentId, scheme: 'semver', operator: 'range', ...(min ? { min } : {}),
      minInclusive: requirement.minInclusive === true, ...(max ? { max } : {}),
      maxInclusive: requirement.maxInclusive === true, allowPrerelease: requirement.allowPrerelease === true }
  }
  throw new Error('无效组件版本条件')
}
function parseCompatibility(value: unknown): RoboCompatibility {
  const compatibility = record(value)
  if (compatibility.compatibilitySchemaVersion !== 2) throw new Error('不支持的技能适配版本')
  const rules = array(compatibility.rules, 100).map(parseCompatibilityRule)
  if (!rules.length) throw new Error('技能缺少适配规则')
  const exclusions = compatibility.exclusions === undefined ? [] : array(compatibility.exclusions, 100).map(parseCompatibilityRule)
  const testedTargets = compatibility.testedTargets === undefined ? [] : array(compatibility.testedTargets, 500).map(item => {
    const target = record(item)
    if (target.result !== 'passed' && target.result !== 'failed') throw new Error('无效技能实测结果')
    return { modelId: string(target.modelId, 129), profileId: string(target.profileId, 128), result: target.result as 'passed' | 'failed', testedAt: string(target.testedAt, 32) }
  })
  return { compatibilitySchemaVersion: 2, rules, exclusions, testedTargets }
}
function parseCompatibilityRule(value: unknown): RoboCompatibilityRule {
  const rule = record(value)
  return { scope: parseCompatibilityScope(rule.scope), requirements: rule.requirements === undefined ? [] : array(rule.requirements, 100).map(parseCompatibilityRequirement) }
}
type MatchTarget = { readonly modelId?: string; readonly seriesId?: string; readonly profileId?: string; readonly components: Readonly<Record<string, RoboComponent>> }
type MatchStatus = 'match' | 'mismatch' | 'unknown'
type Semver = readonly [number, number, number, readonly (number | string)[] | undefined]
function semver(value: string): Semver | undefined {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  if (!match) return undefined
  const prerelease = match[4]?.split('.').map(item => /^\d+$/.test(item) ? Number(item) : item)
  if (prerelease?.some((item, index) => typeof item === 'number' && String(item) !== match[4]?.split('.')[index])) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), prerelease]
}
function compareSemver(left: Semver, right: Semver): number {
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return (left[index] as number) < (right[index] as number) ? -1 : 1
  const a = left[3]; const b = right[3]
  if (!a) return b ? 1 : 0
  if (!b) return -1
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue
    if (typeof a[index] === 'number' && typeof b[index] === 'string') return -1
    if (typeof a[index] === 'string' && typeof b[index] === 'number') return 1
    return (a[index] as number | string) < (b[index] as number | string) ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}
function requirementMatches(requirement: RoboCompatibilityRequirement, target: MatchTarget): MatchStatus {
  const component = target.components[requirement.componentId]
  if (!component) return 'unknown'
  if (component.scheme && component.scheme !== requirement.scheme) return 'mismatch'
  if (requirement.operator === 'exact') {
    if (requirement.scheme === 'exact') return component.version === requirement.value ? 'match' : 'mismatch'
    const actual = semver(component.version); const expected = semver(requirement.value)
    return actual && expected && compareSemver(actual, expected) === 0 ? 'match' : 'mismatch'
  }
  if (requirement.operator === 'in') {
    if (requirement.scheme === 'exact') return requirement.values.includes(component.version) ? 'match' : 'mismatch'
    const actual = semver(component.version)
    return actual && requirement.values.some(value => { const expected = semver(value); return expected !== undefined && compareSemver(actual, expected) === 0 }) ? 'match' : 'mismatch'
  }
  const actual = semver(component.version)
  if (!actual || (actual[3] && !requirement.allowPrerelease)) return 'mismatch'
  if (requirement.min) { const bound = semver(requirement.min); if (!bound) return 'mismatch'; const order = compareSemver(actual, bound); if (order < 0 || (order === 0 && !requirement.minInclusive)) return 'mismatch' }
  if (requirement.max) { const bound = semver(requirement.max); if (!bound) return 'mismatch'; const order = compareSemver(actual, bound); if (order > 0 || (order === 0 && !requirement.maxInclusive)) return 'mismatch' }
  return 'match'
}
function ruleMatches(rule: RoboCompatibilityRule, target: MatchTarget): MatchStatus {
  let scope: MatchStatus = 'mismatch'
  if (rule.scope.kind === 'all') scope = 'match'
  else if (rule.scope.kind === 'series') scope = target.seriesId ? (rule.scope.seriesIds.includes(target.seriesId) ? 'match' : 'mismatch') : 'unknown'
  else if (rule.scope.kind === 'models') scope = target.modelId ? (rule.scope.modelIds.includes(target.modelId) ? 'match' : 'mismatch') : 'unknown'
  else scope = target.modelId && target.profileId ? (rule.scope.targets.some(item => item.modelId === target.modelId && item.profileId === target.profileId) ? 'match' : 'mismatch') : 'unknown'
  if (scope === 'mismatch') return scope
  const statuses = [scope, ...rule.requirements.map(requirement => requirementMatches(requirement, target))]
  return statuses.includes('mismatch') ? 'mismatch' : statuses.includes('unknown') ? 'unknown' : 'match'
}
function compatibilityMatches(compatibility: RoboCompatibility, target: MatchTarget): MatchStatus {
  const excluded = compatibility.exclusions.map(rule => ruleMatches(rule, target))
  if (excluded.includes('match')) return 'mismatch'
  if (excluded.includes('unknown')) return 'unknown'
  const allowed = compatibility.rules.map(rule => ruleMatches(rule, target))
  return allowed.includes('match') ? 'match' : allowed.includes('unknown') ? 'unknown' : 'mismatch'
}
export function parseRoboCatalog(value: unknown): RoboCatalog {
  const raw = record(value)
  if (raw.schemaVersion !== 1 || (raw.mode !== 'local-demo' && raw.mode !== 'catalog')) throw new Error('当前不支持此技能目录版本')
  const mode = raw.mode
  const categories = array(raw.categories, 100).map(item => {
    const r = record(item)
    if (r.visible !== undefined && typeof r.visible !== 'boolean') throw new Error('无效技能分类')
    return { id: string(r.id, 64), name: string(r.name, 100), visible: r.visible ?? true }
  })
  const robots = array(raw.robots).map(item => {
    const r = record(item)
    const profiles = array(r.profiles, 100).map(item => {
      const r = record(item); return { id: string(r.id, 128), label: string(r.label, 512), components: parseComponents(r.components), ...publicDeviceDetails(r) }
    })
    unique(profiles)
    return { id: string(r.id, 129), displayName: string(r.displayName, 100),
      manufacturer: string(r.manufacturer, 100), ...(r.model === undefined ? {} : { model: string(r.model, 100) }), family: string(r.family, 64),
      ...(r.seriesId === undefined ? {} : { seriesId: string(r.seriesId, 129) }), profiles, ...publicDeviceDetails(r) }
  })
  const skills = array(raw.skills).map(item => {
    const r = record(item)
    const execution: RoboSkill['execution'] = r.execution === undefined ? (mode === 'local-demo' ? 'local-demo' : 'server') : r.execution as RoboSkill['execution']
    if ((execution !== 'local-demo' && execution !== 'local-readonly' && execution !== 'server')
      || execution === 'local-demo' !== (mode === 'local-demo')
      || typeof r.demo !== 'boolean' || r.demo !== (mode === 'local-demo')
      || typeof r.robotIndependent !== 'boolean') throw new Error('无效技能适配信息')
    const targets = array(r.targets).map(item => {
      const r = record(item)
      const modelId = string(r.modelId, 129)
      const profileIds = array(r.profileIds, 100).map(id => string(id, 128))
      const robot = robots.find(robot => robot.id === modelId)
      if (!robot || !profileIds.length || new Set(profileIds).size !== profileIds.length
        || profileIds.some(id => !robot.profiles.some(profile => profile.id === id))) throw new Error('技能引用了未知环境')
      return { modelId, profileIds }
    })
    const category = string(r.category, 64)
    const compatibility = r.compatibility === undefined ? undefined : parseCompatibility(r.compatibility)
    if (!categories.some(item => item.id === category) || (compatibility === undefined && r.robotIndependent !== (targets.length === 0))
      || new Set(targets.map(item => item.modelId)).size !== targets.length) throw new Error('无效技能分类或适配信息')
    const publisher = publicPublisher(r.publisher)
    let resolvedIndependent = r.robotIndependent as boolean
    let resolvedTargets = targets
    let compatibilitySummary: RoboSkill['compatibilitySummary']
    if (compatibility) {
      const universal = compatibilityMatches(compatibility, { components: {} }) === 'match'
      resolvedIndependent = universal
      const evaluated = robots.flatMap(robot => robot.profiles.map(profile => ({ robot, profile, status: compatibilityMatches(compatibility, {
        modelId: robot.id, ...(robot.seriesId === undefined ? {} : { seriesId: robot.seriesId }), profileId: profile.id, components: profile.components,
      }) })))
      resolvedTargets = universal ? [] : robots.flatMap(robot => {
        const profileIds = evaluated.filter(item => item.robot.id === robot.id && item.status === 'match').map(item => item.profile.id)
        return profileIds.length ? [{ modelId: robot.id, profileIds }] : []
      })
      compatibilitySummary = { status: universal ? 'universal' : resolvedTargets.length ? 'targeted'
        : evaluated.some(item => item.status === 'unknown') ? 'unknown' : 'mismatch',
      selectableProfiles: resolvedTargets.reduce((count, target) => count + target.profileIds.length, 0) }
    }
    const skillIcon = icon(r.icon)
    const summary = r.summary === undefined ? string(r.description) : string(r.summary, 160)
    return { id: string(r.id, 64), displayName: string(r.displayName, 100),
      summary, version: string(r.version, 32), category,
      robotIndependent: resolvedIndependent, targets: resolvedTargets, demo: r.demo, execution,
      ...(skillIcon === undefined ? {} : { icon: skillIcon }),
      ...(publisher === undefined ? {} : { publisher }),
      ...(r.details === undefined ? {} : { details: parseRoboSkillDetails(r.details) }),
      ...(compatibility === undefined ? {} : { compatibility, compatibilitySummary: compatibilitySummary! }) }
  })
  unique(categories); unique(robots); unique(skills)
  if (raw.marketRevision !== undefined
    && (!Number.isSafeInteger(raw.marketRevision) || (raw.marketRevision as number) < 0)) {
    throw new Error('无效技能市场版本')
  }
  const featuredSkillIds = raw.featuredSkillIds === undefined ? [] : array(raw.featuredSkillIds, 2000)
    .map(id => string(id, 64))
  if (new Set(featuredSkillIds).size !== featuredSkillIds.length
    || featuredSkillIds.some(id => !skills.some(skill => skill.id === id))) {
    throw new Error('精选技能引用无效')
  }
  return { schemaVersion: 1, mode,
    ...(raw.marketRevision === undefined ? {} : { marketRevision: raw.marketRevision as number }),
    featuredSkillIds, categories, robots, skills }
}
export function parseRoboDeviceCatalog(value: unknown): RoboCatalog {
  const raw = record(value)
  return parseRoboCatalog({ ...raw, categories: raw.categories ?? [], skills: raw.skills ?? [] })
}
export function parseRoboResult(value: unknown, selection: RoboSelection): RoboResult {
  const r = record(value)
  if (r.mode !== 'local-demo' || r.demo !== true || r.skillId !== selection.skillId
    || r.skillVersion !== selection.skillVersion) throw new Error('技能结果与本次请求不匹配')
  const output = r.output === undefined ? undefined : parseBumiOutput(r.output)
  return { mode: 'local-demo', demo: true, skillId: selection.skillId, skillVersion: selection.skillVersion,
    summary: output?.summary ?? string(r.summary, 4096), findings: output ? output.findings.map(finding => ({
      level: finding.level === 'observed' ? 'info' : 'warning', message: `${finding.message}（证据：${finding.evidence}）`,
    })) : array(r.findings, 200).map(item => {
      const f = record(item)
      if (f.level !== 'info' && f.level !== 'warning') throw new Error('无效技能结果')
      return { level: f.level, message: string(f.message, 4096) }
    }), ...(output === undefined ? {} : { bumi: output }) }
}
function parseBumiOutput(value: unknown): RoboBumiOutput {
  const r = record(value)
  const status = r.status
  if (status !== 'ready-for-review' && status !== 'ready-for-authorized-validation' && status !== 'needs-investigation' && status !== 'blocked') throw new Error('无效 Bumi 状态')
  const findings = array(r.findings, 20).map(item => { const f = record(item)
    if (!['environment', 'python', 'cpp', 'dds', 'vision', 'deployment', 'motion-safety', 'documentation'].includes(String(f.area)) || !['observed', 'needs-confirmation', 'risk', 'blocked'].includes(String(f.level))) throw new Error('无效 Bumi 发现项')
    return { area: f.area as RoboBumiFinding['area'], level: f.level as RoboBumiFinding['level'], message: string(f.message, 2000), evidence: string(f.evidence, 2000) }
  })
  const proposals = <T extends Record<string, unknown>>(field: string, max: number, parse: (value: Record<string, unknown>) => T) => array(r[field], max).map(item => parse(record(item)))
  const filePatchProposals = proposals('filePatchProposals', 10, item => ({ targetPath: string(item.targetPath, 500), purpose: string(item.purpose, 1000), changeSummary: string(item.changeSummary, 4000), approvalRequired: true as const }))
  const commandProposals = proposals('commandProposals', 10, item => ({ command: string(item.command, 1000), purpose: string(item.purpose, 1000), expectedResult: string(item.expectedResult, 1000), stopCondition: string(item.stopCondition, 1000), approvalRequired: true as const }))
  const deviceOperationProposals = proposals('deviceOperationProposals', 5, item => { if (!['ssh-readonly-check', 'file-transfer-plan', 'dds-connectivity-check', 'camera-validation', 'motion-capable-run'].includes(String(item.operation))) throw new Error('无效 Bumi 设备提案'); return { operation: item.operation as RoboBumiOutput['deviceOperationProposals'][number]['operation'], purpose: string(item.purpose, 1000), preconditions: array(item.preconditions, 10).map(value => string(value, 500)), stopCondition: string(item.stopCondition, 1000), approvalRequired: true as const } })
  const safetyNotes = array(r.safetyNotes, 10).map(item => string(item, 1000))
  if (!findings.length || !safetyNotes.length) throw new Error('Bumi 结果缺少安全字段')
  return { status, summary: string(r.summary, 8000), findings, filePatchProposals, commandProposals, deviceOperationProposals, safetyNotes }
}
export function createRoboSkillsApi(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): RoboSkillsApi {
  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetcher(`/api/desktop/robo-skills/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000),
    })
    if (!response.ok) {
      if (response.status === 503) {
        if (path === 'runs') throw new Error('Bumi 本地安全执行服务未启动，请先启动 services/skills/tools/local_demo_server.py')
        throw new Error(path === 'devices'
          ? '设备目录尚未上线或暂时不可用，请稍后刷新'
          : '技能目录尚未上线或暂时不可用，请稍后刷新')
      }
      if (response.status === 409) throw new Error('技能版本、设备型号或开发方式已变化，请刷新后重新选择')
      if (response.status === 400) throw new Error('请检查输入内容、设备型号和开发方式')
      throw new Error(`技能服务暂时不可用（${response.status}），请重试`)
    }
    const text = await response.text()
    if (text.length > 1_048_576) throw new Error('技能响应过大')
    return JSON.parse(text) as unknown
  }
  return {
    async catalog(signal) { return parseRoboCatalog(await request('catalog', undefined, signal)) },
    async devices(signal) { return parseRoboDeviceCatalog(await request('devices', undefined, signal)) },
    async run(selection, text, signal) {
      if (selection.skillId === 'bumi-sdk-development') {
        const taskType = /运动|motion|publish_cmd/i.test(text) ? 'motion-safety-review' : /deploy|部署|ssh/i.test(text) ? 'deployment-planning' : /camera|vision|相机/i.test(text) ? 'vision-debugging' : 'script-development'
        const files = text.split(/[\s,;]+/u).filter(path => /\.(?:py|cpp|cc|hpp|h|xml|yaml|yml|json|sh)$/iu.test(path)).slice(0, 40).map(path => ({ path, role: /\.py$/i.test(path) ? 'python-script' : /\.xml$|\.ya?ml$/i.test(path) ? 'sdk-config' : 'other', summary: '由桌面输入文本识别的文件线索。' }))
        const input = { taskType, projectSummary: text.slice(0, 12_000), selectedFiles: files, diagnosticText: text, telemetrySummary: '', allowDeviceOperationProposal: false }
        return parseRoboResult(await request('runs', { skillId: selection.skillId, skillVersion: selection.skillVersion, input }, signal), selection)
      }
      return parseRoboResult(await request('demo-runs', { ...selection, text }, signal), selection)
    },
  }
}
export function skillMatchesRobot(skill: RoboSkill, modelId: string): boolean {
  return !modelId || skill.robotIndependent || skill.targets.some(target => target.modelId === modelId)
}
export function selectionFor(skill: RoboSkill, modelId: string, profileId: string): RoboSelection | undefined {
  if (!isRoboSkillRunnable(skill)) return undefined
  if (skill.robotIndependent) return { skillId: skill.id, skillVersion: skill.version }
  if (!skill.targets.some(target => target.modelId === modelId && target.profileIds.includes(profileId))) return undefined
  return { skillId: skill.id, skillVersion: skill.version, modelId, profileId }
}

export function filterRoboSkills(catalog: RoboCatalog, query: string, modelId: string, category: string): readonly RoboSkill[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  return catalog.skills.filter(skill => {
    const robots = catalog.robots.filter(robot => skill.targets.some(target => target.modelId === robot.id))
    const text = [skill.displayName, skill.summary, skill.id,
      skill.details?.overview, ...(skill.details?.inputs ?? []), ...(skill.details?.outputs ?? []),
      ...(skill.details?.limitations ?? []),
      catalog.categories.find(item => item.id === skill.category)?.name,
      ...robots.flatMap(robot => [robot.displayName, robot.manufacturer, robot.id])].join(' ').toLocaleLowerCase()
    return skillMatchesRobot(skill, modelId) && (!category || skill.category === category) && terms.every(term => text.includes(term))
  })
}

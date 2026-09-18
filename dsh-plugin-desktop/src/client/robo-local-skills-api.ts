export interface RoboLocalSkill { readonly name: string; readonly description: string; readonly path: string; readonly userInvocable?: boolean }
export interface RoboLocalSkillsApi {
  list(signal?: AbortSignal): Promise<readonly RoboLocalSkill[]>
  pick(): Promise<string | null>
  import(directory: string): Promise<RoboLocalSkill>
  remove(name: string): Promise<void>
}
const ENDPOINT = '/api/desktop/local-skills'
export function createRoboLocalSkillsApi(fetcher: typeof fetch = (...args) => fetch(...args)): RoboLocalSkillsApi {
  async function request(path: string, init?: RequestInit) {
    const response = await fetcher(path, { credentials: 'same-origin', ...init })
    const value = await response.json()
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : '本地技能操作失败，请重试。')
    return value
  }
  const json = (method: string, body: object): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return {
    async list(signal) { return (await request(ENDPOINT, { signal: signal ?? null })).skills },
    async pick() { return (await request(`${ENDPOINT}/pick-directory`, json('POST', {}))).path },
    async import(directory) { return (await request(ENDPOINT, json('POST', { directory }))).skill },
    async remove(name) { await request(ENDPOINT, json('DELETE', { name })) },
  }
}
export const roboLocalSkillsApi = createRoboLocalSkillsApi()

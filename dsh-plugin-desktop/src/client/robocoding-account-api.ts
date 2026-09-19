import {
  ROBOCODING_ACCOUNT_FUNDING_PATH,
  ROBOCODING_ACCOUNT_LOGIN_PATH,
  ROBOCODING_ACCOUNT_LOGOUT_PATH,
  ROBOCODING_ACCOUNT_PATH,
  ROBOCODING_ACCOUNT_REFRESH_PATH,
  ROBOCODING_ACCOUNT_PLATFORM_PATH,
  type RoboCodingAccountView,
  type RoboCodingFundingMode,
} from '../robocoding-account-contract.ts'

export const ROBO_ACCOUNT_CHANGED = 'robocoding-account-changed'

async function request(path: string, body?: object): Promise<RoboCodingAccountView> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = await response.json().catch(() => { throw new Error('本地账户接口暂不可用，请重启应用后重试') }) as {
    success?: unknown; message?: unknown; error?: unknown; data?: unknown
  }
  if (!response.ok || value.success !== true) {
    const code = typeof value.error === 'string' ? value.error : typeof value.message === 'string' ? value.message : ''
    if (code === 'server_error' || /^http_5\d{2}$/u.test(code)) throw new Error('官方服务暂时不可用，请稍后重试')
    throw new Error(typeof value.message === 'string' ? value.message : '账户操作失败')
  }
  if (body !== undefined && typeof window !== 'undefined') window.dispatchEvent(new Event(ROBO_ACCOUNT_CHANGED))
  return value.data as RoboCodingAccountView
}

export interface RoboCodingAccountApi {
  read(): Promise<RoboCodingAccountView>
  refresh(): Promise<RoboCodingAccountView>
  login(): Promise<RoboCodingAccountView>
  logout(): Promise<RoboCodingAccountView>
  setPlatformUrl(platformUrl: string): Promise<RoboCodingAccountView>
  selectFunding(fundingMode: RoboCodingFundingMode, teamId: number, confirmTeam: boolean): Promise<RoboCodingAccountView>
}

export function createRoboCodingAccountApi(): RoboCodingAccountApi {
  return {
    read: () => request(ROBOCODING_ACCOUNT_PATH),
    refresh: () => request(ROBOCODING_ACCOUNT_REFRESH_PATH, {}),
    login: () => request(ROBOCODING_ACCOUNT_LOGIN_PATH, {}),
    logout: () => request(ROBOCODING_ACCOUNT_LOGOUT_PATH, {}),
    setPlatformUrl: platformUrl => request(ROBOCODING_ACCOUNT_PLATFORM_PATH, { platform_url: platformUrl }),
    selectFunding: (fundingMode, teamId, confirmTeam) => request(ROBOCODING_ACCOUNT_FUNDING_PATH,
      { funding_mode: fundingMode, team_id: teamId, confirm_team: confirmTeam }),
  }
}

export const ROBOCODING_ACCOUNT_PATH = '/api/desktop/robocoding/account'
export const ROBOCODING_ACCOUNT_REFRESH_PATH = '/api/desktop/robocoding/refresh'
export const ROBOCODING_ACCOUNT_LOGIN_PATH = '/api/desktop/robocoding/login'
export const ROBOCODING_ACCOUNT_FUNDING_PATH = '/api/desktop/robocoding/funding'
export const ROBOCODING_ACCOUNT_LOGOUT_PATH = '/api/desktop/robocoding/logout'
export const ROBOCODING_ACCOUNT_PLATFORM_PATH = '/api/desktop/robocoding/platform'

export type RoboCodingFundingMode = 'personal_only' | 'team_only'

export interface RoboCodingTeamView {
  readonly id: number
  readonly name: string
  readonly role: string
  readonly department: string
  readonly balancePoints: number
  readonly monthlyLimitPoints: number | null
  readonly monthlyUsedPoints: number
  readonly month: string
}

export interface RoboCodingAccountView {
  readonly state: 'unconfigured' | 'signed_out' | 'authorizing' | 'signed_in' | 'error'
  readonly platformUrl: string
  readonly message?: string
  readonly user?: { readonly id: number; readonly username: string; readonly displayName: string; readonly balancePoints: number }
  readonly teams: readonly RoboCodingTeamView[]
  readonly funding: { readonly mode: RoboCodingFundingMode; readonly teamId: number; readonly confirmedTeamId: number }
  readonly pointsPerCny: number
  readonly billingCurrency: 'CNY'
  readonly verification?: { readonly userCode: string; readonly verificationUri: string; readonly expiresAt: string }
}

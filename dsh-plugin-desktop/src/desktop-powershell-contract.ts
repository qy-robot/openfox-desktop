/** Same-origin contract for the Windows embedded PowerShell/SSH terminal. */

export const DESKTOP_POWERSHELL_PATH = '/api/desktop/powershell'

export interface DesktopSshConnection {
  readonly host: string
  readonly user?: string
  readonly port?: number
  readonly identityFile?: string
}

export type DesktopPowerShellTarget =
  | { readonly kind: 'local' }
  | {
    readonly kind: 'robot'
    readonly modelId: string
    readonly profileId: string
    readonly label: string
    readonly ssh: DesktopSshConnection
  }

export type DesktopPowerShellRequest =
  | { readonly action: 'open'; readonly target: DesktopPowerShellTarget; readonly cols: number; readonly rows: number }
  | { readonly action: 'read'; readonly sessionId: string; readonly offset: number }
  | { readonly action: 'write'; readonly sessionId: string; readonly data: string }
  | { readonly action: 'resize'; readonly sessionId: string; readonly cols: number; readonly rows: number }
  | { readonly action: 'close'; readonly sessionId: string }

export interface DesktopPowerShellOpenResponse {
  readonly sessionId: string
  readonly target: DesktopPowerShellTarget
  readonly output: string
  readonly offset: number
}

export interface DesktopPowerShellReadResponse {
  readonly output: string
  readonly offset: number
  readonly truncated: boolean
  readonly exited: boolean
  readonly exitCode?: number
}

export interface DesktopPowerShellAcceptedResponse {
  readonly accepted: true
}

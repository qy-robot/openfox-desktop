/** Same-origin endpoint used by the self-drawn Linux enhanced-mode caption controls. */
export const DESKTOP_WINDOW_CONTROLS_PATH = '/_dsh/desktop/window-controls'

/** Caption actions the enhanced Linux shell may request from the Host. */
export type DesktopWindowControlAction = 'minimize' | 'toggle-maximize' | 'close'

/** Renderer-submitted caption action. */
export interface DesktopWindowControlRequest {
  readonly action: DesktopWindowControlAction
}

/** Host acknowledgement without exposing further window state. */
export interface DesktopWindowControlResponse {
  readonly accepted: boolean
}

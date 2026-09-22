import {
  DESKTOP_WINDOW_CONTROLS_PATH,
  type DesktopWindowControlAction,
  type DesktopWindowControlResponse,
} from '../window-controls-contract.ts'

type WindowControlRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function isResponse(value: unknown): value is DesktopWindowControlResponse {
  return typeof value === 'object'
    && value !== null
    && 'accepted' in value
    && (value as { accepted?: unknown }).accepted === true
}

/** Ask the desktop Host to apply one self-drawn caption action (enhanced Linux shell). */
export async function requestDesktopWindowControl(
  action: DesktopWindowControlAction,
  request: WindowControlRequest = window.fetch.bind(window),
): Promise<void> {
  const response = await request(DESKTOP_WINDOW_CONTROLS_PATH, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action }),
  })
  if (!response.ok) throw new Error('DSH Desktop rejected the window control request')
  const value: unknown = await response.json()
  if (!isResponse(value)) throw new Error('DSH Desktop received an invalid window control response')
}

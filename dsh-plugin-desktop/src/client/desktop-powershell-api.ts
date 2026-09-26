/** Browser adapter for the Host-owned embedded terminal. */

import {
  DESKTOP_POWERSHELL_PATH,
  type DesktopPowerShellAcceptedResponse,
  type DesktopPowerShellOpenResponse,
  type DesktopPowerShellReadResponse,
  type DesktopPowerShellRequest,
  type DesktopPowerShellTarget,
} from '../desktop-powershell-contract.ts'

async function request<T>(body: DesktopPowerShellRequest, signal?: AbortSignal): Promise<T> {
  const response = await fetch(DESKTOP_POWERSHELL_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`终端请求失败（${String(response.status)}）`)
  return await response.json() as T
}

export interface DesktopPowerShellApi {
  open(target: DesktopPowerShellTarget, cols: number, rows: number, signal?: AbortSignal): Promise<DesktopPowerShellOpenResponse>
  read(sessionId: string, offset: number, signal?: AbortSignal): Promise<DesktopPowerShellReadResponse>
  write(sessionId: string, data: string, signal?: AbortSignal): Promise<void>
  resize(sessionId: string, cols: number, rows: number, signal?: AbortSignal): Promise<void>
  close(sessionId: string, signal?: AbortSignal): Promise<void>
}

export function createDesktopPowerShellApi(): DesktopPowerShellApi {
  return {
    open: async (target, cols, rows, signal) => await request({ action: 'open', target, cols, rows }, signal),
    read: async (sessionId, offset, signal) => await request({ action: 'read', sessionId, offset }, signal),
    write: async (sessionId, data, signal) => { await request<DesktopPowerShellAcceptedResponse>({ action: 'write', sessionId, data }, signal) },
    resize: async (sessionId, cols, rows, signal) => { await request<DesktopPowerShellAcceptedResponse>({ action: 'resize', sessionId, cols, rows }, signal) },
    close: async (sessionId, signal) => { await request<DesktopPowerShellAcceptedResponse>({ action: 'close', sessionId }, signal) },
  }
}

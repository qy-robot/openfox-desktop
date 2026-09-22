import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  DesktopWindowControlAction,
  DesktopWindowControlRequest,
} from './window-controls-contract.ts'

const MAX_CONTROL_BODY_BYTES = 1024

const ACTIONS = new Set<DesktopWindowControlAction>(['minimize', 'toggle-maximize', 'close'])

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

async function readAction(req: IncomingMessage): Promise<DesktopWindowControlRequest> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_CONTROL_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) throw new Error('request body is required')
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || !('action' in value)) throw new Error('action is required')
  const action = (value as { action?: unknown }).action
  if (typeof action !== 'string' || !ACTIONS.has(action as DesktopWindowControlAction)) {
    throw new Error('action is invalid')
  }
  return { action: action as DesktopWindowControlAction }
}

/** Serve one self-drawn caption control request from the enhanced Linux shell. */
export async function handleDesktopWindowControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controlWindow: (action: DesktopWindowControlAction) => void,
  reportError: (cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (req.headers.origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
  try {
    controlWindow((await readAction(req)).action)
    finishJson(res, 200, { accepted: true })
  } catch (cause: unknown) {
    reportError(cause)
    finishJson(res, 400, { error: 'invalid window control request' })
  }
}

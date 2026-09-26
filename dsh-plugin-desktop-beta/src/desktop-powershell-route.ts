/** Strict same-origin HTTP adapter for the embedded terminal controller. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  DesktopPowerShellRequest,
  DesktopPowerShellTarget,
  DesktopSshConnection,
} from './desktop-powershell-contract.ts'
import type { DesktopPowerShellController } from './desktop-powershell-controller.ts'

const MAX_BODY_BYTES = 72 * 1024
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined
}

function sshConnection(value: unknown): DesktopSshConnection | undefined {
  const item = record(value)
  if (item === undefined) return undefined
  const host = text(item.host, 253)
  const user = item.user === undefined ? undefined : text(item.user, 128)
  const identityFile = item.identityFile === undefined ? undefined : text(item.identityFile, 4096)
  const port = item.port
  if (host === undefined || host.startsWith('-') || /\s/u.test(host)
    || (item.user !== undefined && user === undefined)
    || (item.identityFile !== undefined && identityFile === undefined)
    || (port !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65_535))) return undefined
  return { host, ...(user === undefined ? {} : { user }), ...(port === undefined ? {} : { port: port as number }),
    ...(identityFile === undefined ? {} : { identityFile }) }
}

function target(value: unknown): DesktopPowerShellTarget | undefined {
  const item = record(value)
  if (item?.kind === 'local') return { kind: 'local' }
  if (item?.kind !== 'robot') return undefined
  const modelId = text(item.modelId, 129)
  const profileId = text(item.profileId, 128)
  const label = text(item.label, 100)
  const ssh = sshConnection(item.ssh)
  if (modelId === undefined || profileId === undefined || label === undefined || ssh === undefined) return undefined
  return { kind: 'robot', modelId, profileId, label, ssh }
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : undefined
}

/** Parse the complete renderer command before any PTY operation is invoked. */
export function parseDesktopPowerShellRequest(value: unknown): DesktopPowerShellRequest | undefined {
  const item = record(value)
  if (item === undefined || typeof item.action !== 'string') return undefined
  if (item.action === 'open') {
    const parsedTarget = target(item.target)
    const cols = integer(item.cols, 20, 400)
    const rows = integer(item.rows, 5, 200)
    return parsedTarget === undefined || cols === undefined || rows === undefined
      ? undefined : { action: 'open', target: parsedTarget, cols, rows }
  }
  const sessionId = typeof item.sessionId === 'string' && SESSION_ID.test(item.sessionId) ? item.sessionId : undefined
  if (sessionId === undefined) return undefined
  if (item.action === 'read') {
    const offset = integer(item.offset, 0, Number.MAX_SAFE_INTEGER)
    return offset === undefined ? undefined : { action: 'read', sessionId, offset }
  }
  if (item.action === 'write') {
    return typeof item.data === 'string' && item.data.length > 0 && item.data.length <= 64 * 1024 && !item.data.includes('\0')
      ? { action: 'write', sessionId, data: item.data } : undefined
  }
  if (item.action === 'resize') {
    const cols = integer(item.cols, 20, 400)
    const rows = integer(item.rows, 5, 200)
    return cols === undefined || rows === undefined ? undefined : { action: 'resize', sessionId, cols, rows }
  }
  return item.action === 'close' ? { action: 'close', sessionId } : undefined
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function finishJson(res: ServerResponse, statusCode: number, value: object): void {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

/** Execute one validated embedded-terminal operation. */
export async function handleDesktopPowerShellRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  controller: DesktopPowerShellController,
  reportError: (cause: unknown) => void = () => {},
): Promise<void> {
  if (req.method !== 'POST') return finishJson(res, 405, { error: 'method not allowed' })
  if (req.headers.origin !== expectedOrigin) return finishJson(res, 403, { error: 'forbidden' })
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finishJson(res, 415, { error: 'content type must be application/json' })
  }
  let request: DesktopPowerShellRequest | undefined
  try { request = parseDesktopPowerShellRequest(await readBody(req)) } catch (cause) { reportError(cause) }
  if (request === undefined) return finishJson(res, 400, { error: 'invalid terminal request' })
  try {
    if (request.action === 'open') return finishJson(res, 200, controller.open(request.target, request.cols, request.rows))
    if (request.action === 'read') return finishJson(res, 200, controller.read(request.sessionId, request.offset))
    if (request.action === 'write') controller.write(request.sessionId, request.data)
    else if (request.action === 'resize') controller.resize(request.sessionId, request.cols, request.rows)
    else controller.close(request.sessionId)
    finishJson(res, 200, { accepted: true })
  } catch (cause) {
    reportError(cause)
    finishJson(res, request.action === 'open' ? 503 : 409, { error: 'terminal operation failed' })
  }
}

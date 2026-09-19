import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RoboCodingAccountController } from './robocoding-account-controller.ts'
import type { RoboCodingFundingMode } from './robocoding-account-contract.ts'

const MAX_BODY_BYTES = 8 * 1024

function json(res: ServerResponse, status: number, body: object, allow?: string): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new TypeError('content type must be application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += value.byteLength
    if (size > MAX_BODY_BYTES) throw new RangeError('request body is too large')
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') throw new TypeError('request body is required')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TypeError('invalid request')
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid request')
  return value as Record<string, unknown>
}

export async function handleRoboCodingAccountRequest(
  kind: 'read' | 'refresh' | 'login' | 'funding' | 'logout' | 'platform',
  req: IncomingMessage,
  res: ServerResponse,
  controller: RoboCodingAccountController,
): Promise<void> {
  const expectedMethod = kind === 'read' ? 'GET' : 'POST'
  if (req.method !== expectedMethod) return json(res, 405, { success: false, message: 'method not allowed' }, expectedMethod)
  try {
    if (kind === 'read') return json(res, 200, { success: true, data: controller.read() })
    const value = record(await body(req))
    if (kind === 'refresh') await controller.reload()
    else if (kind === 'login') await controller.beginLogin()
    else if (kind === 'logout') await controller.logout()
    else if (kind === 'platform') {
      if (typeof value.platform_url !== 'string') throw new TypeError('invalid platform URL')
      await controller.setPlatformUrl(value.platform_url)
    } else {
      const mode: RoboCodingFundingMode | undefined = value.funding_mode === 'personal_only' || value.funding_mode === 'team_only'
        ? value.funding_mode : undefined
      if (mode === undefined || !Number.isSafeInteger(value.team_id)
        || (value.confirm_team !== undefined && typeof value.confirm_team !== 'boolean')) throw new TypeError('invalid funding selection')
      await controller.selectFunding(mode, value.team_id as number, value.confirm_team === true)
    }
    json(res, 200, { success: true, data: controller.read() })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const error = cause instanceof Error && cause.name !== 'Error' ? cause.name : undefined
    json(res, cause instanceof RangeError ? 413 : 400, { success: false,
      ...(error === undefined ? {} : { error }), message })
  }
}

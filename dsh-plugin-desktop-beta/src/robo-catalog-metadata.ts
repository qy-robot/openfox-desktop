/** Public marketplace metadata, shared by the Host projection and renderer. */
export interface RoboPublisher {
  readonly kind: 'company' | 'community'
  readonly displayName: string
  readonly labels: readonly string[]
}
export interface RoboDeviceDetails {
  /** Public, square-cropped device image data URL. */
  readonly image?: string
  readonly description?: string
  readonly configuration?: Readonly<Record<string, unknown>>
  readonly tutorialUrl?: string
}

export function isFeishuTutorialUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['feishu.cn', 'larksuite.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch { return false }
}

export function publicDeviceDetails(value: Record<string, unknown>): RoboDeviceDetails {
  const result: { image?: string; description?: string; configuration?: Record<string, unknown>; tutorialUrl?: string } = {}
  if (value.image !== undefined) {
    if (typeof value.image !== 'string' || value.image.length > 400_000
      || (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.image)
        && !/^https:\/\/(?:www\.)?unitree\.com\/images\/[A-Za-z0-9._%/-]+(?:\?[^\s]*)?$/u.test(value.image))) throw new Error('无效设备图片')
    result.image = value.image
  }
  if (value.description !== undefined) {
    if (typeof value.description !== 'string' || value.description.length > 4000) throw new Error('无效设备介绍')
    result.description = value.description
  }
  if (value.configuration !== undefined) {
    if (!value.configuration || typeof value.configuration !== 'object' || Array.isArray(value.configuration)
      || new TextEncoder().encode(JSON.stringify(value.configuration)).length > 16384) throw new Error('无效设备配置')
    result.configuration = value.configuration as Record<string, unknown>
  }
  if (value.tutorialUrl !== undefined && value.tutorialUrl !== '') {
    if (!isFeishuTutorialUrl(value.tutorialUrl)) throw new Error('无效飞书教程链接')
    result.tutorialUrl = value.tutorialUrl
  }
  return result
}

export function publicPublisher(value: unknown): RoboPublisher | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效发布者')
  const item = value as Record<string, unknown>
  if ((item.kind !== 'company' && item.kind !== 'community') || typeof item.displayName !== 'string'
    || !item.displayName.trim() || item.displayName.length > 100 || !Array.isArray(item.labels)
    || item.labels.length > 20 || item.labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 64)
) {
    throw new Error('无效发布者')
  }
  return { kind: item.kind, displayName: item.displayName, labels: item.labels as string[] }
}

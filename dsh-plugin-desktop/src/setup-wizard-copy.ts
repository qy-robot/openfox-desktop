/** Bilingual copy for the pre-Host native Setup Wizard. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopSetupWizardCopy {
  readonly aaTitle: string
  readonly aaIntro: string
  readonly aaDisabled: string
  readonly aaDisabledBody: string
  readonly aaEnabled: string
  readonly aaEnabledBody: string
  readonly aaNextTitle: string
  readonly aaNextBody: string
  readonly aaNextDesktop: string
  readonly beta: string
  readonly title: string
  readonly profile: string
  readonly welcomeTitle: string
  readonly welcomeBody: string
  readonly firstProfileSetup: string
  readonly startSetup: string
  readonly serviceTitle: string
  readonly serviceBody: string
  readonly officialService: string
  readonly officialServiceBody: string
  readonly accountNextStep: string
  readonly customModels: string
  readonly customModelsBody: string
  readonly unavailableOnLinux: string
  readonly windowMaterial: string
  readonly windowMaterialBody: string
  readonly materialOff: string
  readonly materialOffBody: string
  readonly materialTransparent: string
  readonly materialTransparentBody: string
  readonly materialMica: string
  readonly materialMicaBody: string
  readonly marketTitle: string
  readonly marketBody: string
  readonly marketDisabled: string
  readonly marketDisabledBody: string
  readonly communityMarket: string
  readonly communityMarketBody: string
  readonly dshMarket: string
  readonly dshMarketBody: string
  readonly notificationsTitle: string
  readonly notificationsBody: string
  readonly notificationsEnabled: string
  readonly turnCompletion: string
  readonly turnFailure: string
  readonly jobCompletion: string
  readonly jobFailure: string
  readonly back: string
  readonly next: string
  readonly skip: string
  readonly skipDialogTitle: string
  readonly skipDialogBody: string
  readonly cancelSkip: string
  readonly confirmSkip: string
  readonly successTitle: string
  readonly successBody: string
  readonly startUsing: string
  readonly invalidState: string
}

const COPY: Record<DesktopLocale, DesktopSetupWizardCopy> = {
  en: {
    aaTitle: 'Agents-Anywhere',
    aaIntro: 'Use Agents-Anywhere to access OpenFox on this computer from your phone or a browser.',
    aaDisabled: 'Turn off phone connection',
    aaDisabledBody: 'Do not use Agents-Anywhere to access this computer from a phone or browser.',
    aaEnabled: 'Turn on phone connection',
    aaEnabledBody: 'After enabling, open Phone connection in the sidebar to finish setup.',
    aaNextTitle: 'Connect a device',
    aaNextBody: 'After setup, open Phone connection in the sidebar to continue connecting your device.',
    aaNextDesktop: 'If the Agents-Anywhere desktop app is installed on this computer, manage the connection directly in that app.',

    beta: 'Beta',
    title: 'Set up OpenFox',
    profile: 'Profile',
    welcomeTitle: 'Welcome to OpenFox',
    welcomeBody: 'Set up model access, window appearance, phone connection, and notifications for the current Profile.',
    firstProfileSetup: 'Complete Desktop setup before using this configuration environment (Profile) for the first time.',
    startSetup: 'Start setup',
    serviceTitle: 'Choose how to use models',
    serviceBody: 'OpenFox uses your signed-in account by default. No API key is required during first-time setup.',
    officialService: 'OpenFox service',
    officialServiceBody: 'Sign in from Settings after setup to use the official service and your account balance.',
    accountNextStep: 'You can finish setup now and sign in after the app opens.',
    customModels: 'Custom models',
    customModelsBody: 'You can later add another provider under Settings > Models, including its API key and service URL. OpenFox will try to detect the protocol and model list automatically, and lets you edit them manually.',
    unavailableOnLinux: 'This mode is currently available on macOS and Windows.',
    windowMaterial: 'Choose a window material',
    windowMaterialBody: 'Choose a window background effect.',
    materialOff: 'Solid background',
    materialOffBody: 'Use a solid, opaque window background.',
    materialTransparent: 'Glass background',
    materialTransparentBody: 'Show a blurred view of the content behind the window.',
    materialMica: 'Mica',
    materialMicaBody: 'Use the native Windows Mica material when it is supported.',
    marketTitle: 'Choose a plugin market',
    marketBody: 'Choose a plugin market for the current Profile. Only one can be enabled at a time.',
    marketDisabled: 'Turn off plugin market',
    marketDisabledBody: 'Do not load a plugin market interface.',
    communityMarket: 'Open plugin market',
    communityMarketBody: 'The open market built into OpenFox, including custom data sources.',
    dshMarket: 'Community plugin market',
    dshMarketBody: 'A community-maintained catalog of compatible plugins.',
    notificationsTitle: 'Set up Desktop notifications',
    notificationsBody: 'Receive system notifications when tasks finish or fail. Notifications do not show conversation content.',
    notificationsEnabled: 'Enable Desktop notifications',
    turnCompletion: 'Current turn completed',
    turnFailure: 'Current turn failed',
    jobCompletion: 'Background job completed',
    jobFailure: 'Background job failed',
    back: 'Previous',
    next: 'Next',
    skip: 'Skip setup',
    skipDialogTitle: 'Skip setup?',
    skipDialogBody: 'You can still configure all of these options later under Settings > Desktop settings.',
    cancelSkip: 'Continue setup',
    confirmSkip: 'Skip setup',
    successTitle: 'Setup complete',
    successBody: 'Desktop settings have been saved for the current Profile.',
    startUsing: 'Start using OpenFox',
    invalidState: 'Setup information could not be loaded. Close this window and try again.',
  },
  zh: {
    aaTitle: 'Agents-Anywhere',
    aaIntro: '通过 Agents-Anywhere，在手机或浏览器中访问这台电脑上的 OpenFox。',
    aaDisabled: '关闭手机连接',
    aaDisabledBody: '不在手机或浏览器中通过 Agents-Anywhere 访问这台电脑。',
    aaEnabled: '开启手机连接',
    aaEnabledBody: '开启后，打开侧边栏中的“手机连接”完成设置。',
    aaNextTitle: '连接设备',
    aaNextBody: '完成设置后，打开侧边栏中的“手机连接”，继续连接设备。',
    aaNextDesktop: '如果本机已安装 Agents-Anywhere 桌面端，直接在桌面端管理连接即可。',

    beta: 'Beta',
    title: '设置 OpenFox',
    profile: 'Profile',
    welcomeTitle: '欢迎使用 OpenFox',
    welcomeBody: '为当前 Profile 设置模型服务、窗口外观、手机连接和桌面通知。',
    firstProfileSetup: '首次使用此配置环境（Profile），请先完成桌面设置。',
    startSetup: '开始设置',
    serviceTitle: '选择模型使用方式',
    serviceBody: '默认使用已登录的 OpenFox 账号，首次设置无需填写 API Key。',
    officialService: 'OpenFox 官方服务',
    officialServiceBody: '完成设置后，在“设置”中登录账号，即可使用官方模型服务和账号点数。',
    accountNextStep: '现在可以继续完成桌面设置，打开应用后再登录。',
    customModels: '自定义模型',
    customModelsBody: '之后可在“设置” > “模型”中添加其他服务，填写 API Key 和服务地址。OpenFox 会尝试自动识别协议并获取模型列表，也可手动修改。',
    unavailableOnLinux: '此模式目前支持 macOS 和 Windows。',
    windowMaterial: '选择窗口材质',
    windowMaterialBody: '选择窗口背景效果。',
    materialOff: '纯色背景',
    materialOffBody: '使用不透明的纯色窗口背景。',
    materialTransparent: '玻璃背景',
    materialTransparentBody: '透出窗口背后的内容，并呈现模糊效果。',
    materialMica: 'Mica',
    materialMicaBody: '在系统支持时使用 Windows 原生 Mica 材质。',
    marketTitle: '选择插件市场',
    marketBody: '为当前 Profile 选择一个插件市场。一次只能启用一个。',
    marketDisabled: '关闭插件市场',
    marketDisabledBody: '不加载插件市场界面。',
    communityMarket: '开放插件市场',
    communityMarketBody: 'OpenFox 内置的开放市场，并支持自定义数据源。',
    dshMarket: '社区插件市场',
    dshMarketBody: '由社区维护的兼容插件目录。',
    notificationsTitle: '设置桌面通知',
    notificationsBody: '在任务完成或失败时接收系统通知。通知不会显示会话内容。',
    notificationsEnabled: '启用桌面通知',
    turnCompletion: '本轮任务完成',
    turnFailure: '本轮任务失败',
    jobCompletion: '后台任务完成',
    jobFailure: '后台任务失败',
    back: '上一步',
    next: '下一步',
    skip: '跳过设置',
    skipDialogTitle: '跳过设置？',
    skipDialogBody: '之后仍可在“设置” > “桌面设置”中配置这里的所有内容。',
    cancelSkip: '继续设置',
    confirmSkip: '跳过设置',
    successTitle: '设置完成',
    successBody: '当前 Profile 的桌面设置已保存。',
    startUsing: '开始使用',
    invalidState: '无法加载设置信息。请关闭此窗口后重试。',
  },
}

export function desktopSetupWizardCopy(locale: DesktopLocale): DesktopSetupWizardCopy {
  return COPY[locale]
}

/** RoboCoding's small, Desktop-owned brand occupants. */

import { useState } from 'react'

export const ROBO_BRAND_NAME = 'RoboCoding'
export const ROBO_BRAND_BYLINE = 'by擎云机器人'
export const ROBO_HERO_SLOGANS = [
  '不是学好了再干，而是在干中学。',
  '先让机器人动起来，再让想法更准确。',
  '每一次尝试，都是下一次进步的起点。',
  '把一个想法，做成一次真实的动作。',
  '先开始，再把它做好。',
] as const

export const ROBO_HERO_SLOGAN = ROBO_HERO_SLOGANS[0]

export function selectRoboHeroSlogan(random = Math.random): string {
  return ROBO_HERO_SLOGANS[Math.floor(random() * ROBO_HERO_SLOGANS.length)]
    ?? ROBO_HERO_SLOGAN
}

const BRAND_STYLES = `
.roboHeroBrand {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.roboHeroSlogan {
  max-width: 100%;
  font-size: 28px;
  line-height: 34px;
  text-align: center;
  text-wrap: balance;
  white-space: normal;
}
/* Keep the empty conversation focused on the slogan, using the owned slot
   anchor to suppress the upstream title and preview group. */
span:has(> [data-slot="conversation.hero.brand.mark"] .roboHeroBrand) {
  min-width: 0;
  max-width: 100%;
  flex-shrink: 1;
}
span:has(> [data-slot="conversation.hero.brand.mark"] .roboHeroBrand) + span { display: none; }

/* Keep the wordmark header and remove the mark slot wrapper, including its gap. */
div:has(> button [data-slot="sidebar.brand.name"] .roboBrandName) {
  height: 76px;
}
button:has([data-slot="sidebar.brand.name"] .roboBrandName) > span {
  height: 44px;
  gap: 10px;
}
span:has(> [data-slot="sidebar.brand.name"] .roboBrandName) {
  height: auto;
}
span:has(> [data-slot="sidebar.brand.mark"] .roboBrandMark) {
  display: none;
}
/* The collapsed rail must still expose its existing expand control. */
button:has([data-slot="sidebar.brand.mark"] .roboBrandMark) > svg {
  display: inline !important;
}
.roboBrandName {
  display: inline-flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  justify-content: center;
  gap: 0;
  line-height: 1;
  white-space: nowrap;
}
.roboBrandWordmark {
  display: block;
  width: min(174px, 100%);
  color: var(--dsw-alias-label-primary);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 26px;
}
.roboBrandName small {
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  letter-spacing: 0;
}
`

export function RoboBrandMark() {
  return <span className="roboBrandMark" hidden aria-hidden="true" />
}

export function RoboBrandName() {
  return (
    <span className="roboBrandName">
      <span className="roboBrandWordmark">{ROBO_BRAND_NAME}</span>
      <small>{ROBO_BRAND_BYLINE}</small>
    </span>
  )
}

export function installRoboBrandStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plugin-desktop/robo-brand'
  style.textContent = BRAND_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

export function RoboHeroBrand() {
  const [slogan] = useState(() => selectRoboHeroSlogan())

  return <span className="roboHeroBrand">
    <span className="roboHeroSlogan">{slogan}</span>
  </span>
}

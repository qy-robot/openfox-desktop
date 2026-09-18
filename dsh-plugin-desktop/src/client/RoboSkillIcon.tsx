import { CircleDot } from 'lucide-react'
import type { ReactNode } from 'react'

export function RoboSkillIcon({ icon, label, fallback }: {
  readonly icon?: string | undefined
  readonly label: string
  readonly fallback?: ReactNode | undefined
}) {
  return icon
    ? <img className="roboSkillIconImage" src={icon} alt="" aria-label={`${label}图标`} />
    : fallback ?? <CircleDot aria-hidden="true" />
}

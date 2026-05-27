import type { LucideIcon } from 'lucide-react'
import { Coins, Home, Rocket, Sparkles, Upload } from 'lucide-react'

export type OwlCenterNavItem = {
  href: string
  label: string
  shortLabel?: string
  description: string
  icon: LucideIcon
  /** Match pathname prefix (e.g. /owl-center/collection/gen2). */
  matchPrefix?: string
}

export const OWL_CENTER_NAV_ITEMS: OwlCenterNavItem[] = [
  {
    href: '/owl-center',
    label: 'Hub',
    description: 'Owl Center home and featured launches',
    icon: Home,
  },
  {
    href: '/owl-center/collection/gen2',
    label: 'Gen2 Mint',
    shortLabel: 'Mint',
    description: 'Check allocation and mint Owltopia Gen2',
    icon: Rocket,
    matchPrefix: '/owl-center/collection/gen2',
  },
  {
    href: '/gen2-presale',
    label: 'Gen2 Presale',
    shortLabel: 'Presale',
    description: 'Buy presale spots and view balance',
    icon: Sparkles,
    matchPrefix: '/gen2-presale',
  },
  {
    href: '/owl-center/drops',
    label: 'Live Drops',
    shortLabel: 'Drops',
    description: 'All active Owl Center mints',
    icon: Coins,
    matchPrefix: '/owl-center/drops',
  },
  {
    href: '/owl-center/launch',
    label: 'Submit',
    description: 'Submit a collection for Owl Center review',
    icon: Upload,
    matchPrefix: '/owl-center/launch',
  },
]

export type OwlCenterGen2Section = {
  id: string
  label: string
  shortLabel?: string
}

export const OWL_CENTER_GEN2_SECTIONS: OwlCenterGen2Section[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Status' },
  { id: 'wallets', label: 'Wallets', shortLabel: 'Link' },
  { id: 'allocation', label: 'Allocation', shortLabel: 'Check' },
  { id: 'mint', label: 'Mint', shortLabel: 'Mint' },
  { id: 'activity', label: 'Activity', shortLabel: 'Log' },
]

export function isOwlCenterNavActive(pathname: string, item: OwlCenterNavItem): boolean {
  const prefix = item.matchPrefix ?? item.href
  if (pathname === item.href) return true
  if (prefix === '/owl-center' && pathname.startsWith('/owl-center')) {
    if (item.href !== '/owl-center') return pathname.startsWith(prefix)
    return (
      pathname === '/owl-center' ||
      (pathname.startsWith('/owl-center/') &&
        !pathname.startsWith('/owl-center/collection') &&
        !pathname.startsWith('/owl-center/drops') &&
        !pathname.startsWith('/owl-center/launch'))
    )
  }
  return pathname.startsWith(`${prefix}/`) || pathname === prefix
}

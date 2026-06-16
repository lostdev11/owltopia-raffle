import type { LucideIcon } from 'lucide-react'
import { Coins, Home, Layers, PenLine, Rocket, Upload } from 'lucide-react'

export type OwlCenterNavItem = {
  href: string
  label: string
  shortLabel?: string
  description: string
  icon: LucideIcon
  /** Match pathname prefix (e.g. /owl-center/collection/gen2). */
  matchPrefix?: string
  /** Hidden from public view — generator, launch submit, etc. */
  adminOnly?: boolean
}

/** Default nav for holders and visitors (matches pre-launchpad public Owl Center). */
export const OWL_CENTER_PUBLIC_NAV_ITEMS: OwlCenterNavItem[] = [
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
    href: '/owl-center/drops',
    label: 'Live Drops',
    shortLabel: 'Drops',
    description: 'All active Owl Center mints',
    icon: Coins,
    matchPrefix: '/owl-center/drops',
  },
  {
    href: '/owl-center/my-launches',
    label: 'My Launches',
    shortLabel: 'Mine',
    description: 'Partner creator portal — mint settings, metadata, Magic Eden prep',
    icon: PenLine,
    matchPrefix: '/owl-center/my-launches',
  },
]
export const OWL_CENTER_ADMIN_NAV_ITEMS: OwlCenterNavItem[] = [
  {
    href: '/owl-center/generator',
    label: 'Generator',
    shortLabel: 'Gen',
    description: 'Trait layers, pairing rules, and Sugar export',
    icon: Layers,
    matchPrefix: '/owl-center/generator',
    adminOnly: true,
  },
  {
    href: '/owl-center/launch',
    label: 'Submit',
    description: 'Submit a collection for Owl Center review',
    icon: Upload,
    matchPrefix: '/owl-center/launch',
    adminOnly: true,
  },
]

/** Full nav (public + admin tools). Prefer owlCenterNavItemsForView() in UI. */
export const OWL_CENTER_NAV_ITEMS: OwlCenterNavItem[] = [
  ...OWL_CENTER_PUBLIC_NAV_ITEMS,
  ...OWL_CENTER_ADMIN_NAV_ITEMS,
]

export function owlCenterNavItemsForView(showAdminFeatures: boolean): OwlCenterNavItem[] {
  return showAdminFeatures ? OWL_CENTER_NAV_ITEMS : OWL_CENTER_PUBLIC_NAV_ITEMS
}

export type OwlCenterGen2Section = {
  id: string
  label: string
  shortLabel?: string
}

export const OWL_CENTER_GEN2_SECTIONS: OwlCenterGen2Section[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Status' },
  { id: 'whitelist', label: 'Whitelist', shortLabel: 'WL' },
  { id: 'wallets', label: 'Wallets', shortLabel: 'Link' },
  { id: 'allocation', label: 'Allocation', shortLabel: 'Check' },
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
        !pathname.startsWith('/owl-center/my-launches') &&
        !pathname.startsWith('/owl-center/generator') &&
        !pathname.startsWith('/owl-center/launch'))
    )
  }
  return pathname.startsWith(`${prefix}/`) || pathname === prefix
}

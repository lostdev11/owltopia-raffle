import type { LucideIcon } from 'lucide-react'
import {
  Bird,
  Gift,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  Plus,
  Rocket,
  Settings,
  ShoppingCart,
  Sparkles,
  Ticket,
  Trophy,
} from 'lucide-react'

export type SiteNavItem = {
  href: string
  label: string
  description?: string
  icon: LucideIcon
}

export type SiteNavGroup = {
  id: string
  label: string
  menuAriaLabel: string
  mobileSectionLabel: string
  triggerIcon: LucideIcon
  items: SiteNavItem[]
  /** Icon tint on menu rows and trigger (e.g. emerald for raffles). */
  iconAccentClass?: string
}

/** @deprecated Use SiteNavItem — kept for existing imports. */
export type RafflesNavItem = SiteNavItem

export const RAFFLES_NAV_GROUP: SiteNavGroup = {
  id: 'raffles',
  label: 'Raffles',
  menuAriaLabel: 'Raffles and partners',
  mobileSectionLabel: 'Raffles & partners',
  triggerIcon: Ticket,
  iconAccentClass: 'text-emerald-400/90',
  items: [
    {
      href: '/raffles',
      label: 'Browse raffles',
      description: 'Main raffle catalog — enter and buy tickets',
      icon: Ticket,
    },
    {
      href: '/cart',
      label: 'Cart',
      description: 'Checkout only — tickets you already added',
      icon: ShoppingCart,
    },
    {
      href: '/partner-program',
      label: 'Partner program',
      description: 'Apply or learn about partner tiers',
      icon: HeartHandshake,
    },
    {
      href: '/partner-raffles',
      label: 'Partner raffles',
      description: 'Raffles from verified partner communities',
      icon: Ticket,
    },
    {
      href: '/partners/dashboard',
      label: 'Partner hub',
      description: 'Host dashboard after partner onboarding',
      icon: HeartHandshake,
    },
  ],
}

/** @deprecated Use RAFFLES_NAV_GROUP.items */
export const RAFFLES_NAV_ITEMS = RAFFLES_NAV_GROUP.items

export const COMMUNITY_NAV_GROUP: SiteNavGroup = {
  id: 'community',
  label: 'Community',
  menuAriaLabel: 'Community',
  mobileSectionLabel: 'Community',
  triggerIcon: Landmark,
  iconAccentClass: 'text-sky-400/90',
  items: [
    {
      href: '/leaderboard',
      label: 'Leaderboard',
      description: 'Rankings, XP, and seasonal standings',
      icon: Trophy,
    },
    {
      href: '/council',
      label: 'Council',
      description: 'Governance proposals and voting',
      icon: Landmark,
    },
    {
      href: '/owl-center',
      label: 'Owl Center',
      description: 'Launches, mints, and collection infrastructure',
      icon: Rocket,
    },
  ],
}

export const OWLS_NAV_GROUP: SiteNavGroup = {
  id: 'owls',
  label: 'Owls',
  menuAriaLabel: 'Owls and presale',
  mobileSectionLabel: 'Owls & presale',
  triggerIcon: Bird,
  iconAccentClass: 'text-violet-400/90',
  items: [
    {
      href: '/owl-center/collection/gen2',
      label: 'Gen2 Mint',
      description: 'Check allocation and mint Owltopia Gen2',
      icon: Rocket,
    },
    {
      href: '/gen2-presale',
      label: 'Gen2 Presale',
      description: 'Buy presale spots before mint',
      icon: Sparkles,
    },
    {
      href: '/nesting',
      label: 'Nesting',
      description: 'Stake owls and NFTs to earn OWL',
      icon: Bird,
    },
  ],
}

export const DASHBOARD_NAV_ITEM: SiteNavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  description: 'Your entries, hosting, wins, and wallet',
  icon: LayoutDashboard,
}

export const ADMIN_NAV_GROUP: SiteNavGroup = {
  id: 'admin',
  label: 'Admin',
  menuAriaLabel: 'Admin tools',
  mobileSectionLabel: 'Admin',
  triggerIcon: Settings,
  iconAccentClass: 'text-amber-400/90',
  items: [
    {
      href: '/admin',
      label: 'Owl Vision',
      description: 'Platform admin and raffle oversight',
      icon: Settings,
    },
    {
      href: '/admin/community-giveaways',
      label: 'Giveaways',
      description: 'Manage community giveaways',
      icon: Gift,
    },
    {
      href: '/admin/raffles/new',
      label: 'Create Raffle',
      description: 'Start a new raffle listing',
      icon: Plus,
    },
  ],
}

export function isPathInNavGroup(pathname: string, group: SiteNavGroup): boolean {
  return group.items.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
}

export function filterAdminNavItems(options: {
  showOwlVision: boolean
  showCreateRaffle: boolean
}): SiteNavItem[] {
  const { showOwlVision, showCreateRaffle } = options
  return ADMIN_NAV_GROUP.items.filter((item) => {
    if (item.href === '/admin/raffles/new') return showCreateRaffle
    return showOwlVision
  })
}

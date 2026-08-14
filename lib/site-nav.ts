import type { LucideIcon } from 'lucide-react'
import {
  Bird,
  Gavel,
  Gift,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  Package,
  Plus,
  Rocket,
  Send,
  Settings,
  ShoppingCart,
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
    {
      href: '/auctions',
      label: 'Partner auctions',
      description: 'Beta — partners & admins only (NFT / SOL / USDC)',
      icon: Gavel,
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
      description: 'Seasonal standings and ticket rankings',
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
    {
      href: '/owl-send',
      label: 'OwlSend',
      description: 'Send NFTs & tokens — 0.001 SOL fee',
      icon: Send,
    },
    {
      href: '/packs',
      label: 'Owl Packs',
      description: 'Rip packs — every open wins OWL, SOL, or NFT',
      icon: Package,
    },
  ],
}

const OWL_SEND_NAV_DESCRIPTION_PUBLIC = 'Send NFTs & tokens — 0.001 SOL fee'
const OWL_SEND_NAV_DESCRIPTION_PREVIEW = 'Send NFTs & tokens — 0.001 SOL fee (admin preview)'
const OWL_PACKS_NAV_DESCRIPTION_PUBLIC = 'Rip packs — every open wins OWL, SOL, or NFT'
const OWL_PACKS_NAV_DESCRIPTION_PREVIEW =
  'Rip packs — every open wins OWL, SOL, or NFT (admin preview)'

export const OWLS_NAV_GROUP: SiteNavGroup = {
  id: 'owls',
  label: 'Owls',
  menuAriaLabel: 'Owls',
  mobileSectionLabel: 'Owls',
  triggerIcon: Bird,
  iconAccentClass: 'text-violet-400/90',
  items: [
    {
      href: '/owl-center/collection/gen2',
      label: 'Gen2 Mint',
      description: 'Check allocation and mint Owltopia Gen2',
      icon: Rocket,
    },
  ],
}

/**
 * Top-level header link so holders don't have to hunt through the Owls dropdown.
 * (Was previously the third item inside OWLS_NAV_GROUP.)
 */
export const NESTING_NAV_ITEM: SiteNavItem = {
  href: '/nesting',
  label: 'Nesting',
  description: 'Stake owls and NFTs to earn OWL',
  icon: Bird,
}

export const DASHBOARD_NAV_ITEM: SiteNavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  description: 'Your entries, hosting, wins, and wallet',
  icon: LayoutDashboard,
}

/** Available to any connected wallet (raffle creation is open to all hosts), shown next to Dashboard. */
export const CREATE_RAFFLE_NAV_ITEM: SiteNavItem = {
  href: '/admin/raffles/new',
  label: 'Create Raffle',
  description: 'Start a new raffle listing',
  icon: Plus,
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
      href: '/admin/owl-send',
      label: 'OwlSend',
      description: 'Admin test bench for NFT/token sends',
      icon: Send,
    },
    {
      href: '/admin/packs',
      label: 'Packs',
      description: 'Pack vault, inventory, and pause/unpause',
      icon: Package,
    },
  ],
}

export function isPathInNavGroup(pathname: string, group: SiteNavGroup): boolean {
  return group.items.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
}

/** Hide OwlSend / Owl Packs from Community nav during admin-only preview; label by public gate. */
export function filterCommunityNavItems(options: {
  showOwlSend: boolean
  /** When false (admin preview), keep the "(admin preview)" subtitle. */
  owlSendPublic?: boolean
  showOwlPacks?: boolean
  /** When false (admin preview), keep the "(admin preview)" subtitle. */
  owlPacksPublic?: boolean
}): SiteNavItem[] {
  let items = options.showOwlSend
    ? COMMUNITY_NAV_GROUP.items
    : COMMUNITY_NAV_GROUP.items.filter((item) => item.href !== '/owl-send')
  if (options.showOwlPacks === false) {
    items = items.filter((item) => item.href !== '/packs')
  }
  const owlSendPublic = options.owlSendPublic === true
  const owlPacksPublic = options.owlPacksPublic === true
  return items.map((item) => {
    if (item.href === '/owl-send') {
      return {
        ...item,
        description: owlSendPublic
          ? OWL_SEND_NAV_DESCRIPTION_PUBLIC
          : OWL_SEND_NAV_DESCRIPTION_PREVIEW,
      }
    }
    if (item.href === '/packs') {
      return {
        ...item,
        description: owlPacksPublic
          ? OWL_PACKS_NAV_DESCRIPTION_PUBLIC
          : OWL_PACKS_NAV_DESCRIPTION_PREVIEW,
      }
    }
    return item
  })
}

/** Admin menu items are admin-only. Create Raffle is no longer here (see CREATE_RAFFLE_NAV_ITEM). */
export function filterAdminNavItems(options: {
  showOwlVision: boolean
  adminRole?: 'full' | 'mod' | null
}): SiteNavItem[] {
  if (!options.showOwlVision) return []
  return options.adminRole === 'mod'
    ? [ADMIN_NAV_GROUP.items[0]]
    : [...ADMIN_NAV_GROUP.items]
}

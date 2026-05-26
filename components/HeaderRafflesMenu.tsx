'use client'

import { RAFFLES_NAV_GROUP } from '@/lib/site-nav'
import { HeaderNavGroupMenuDesktop, HeaderNavGroupMenuMobile } from '@/components/HeaderNavGroupMenu'

type DesktopProps = {
  buttonClassName?: string
}

/** Desktop: Raffles dropdown with browse, cart, and partner links. */
export function HeaderRafflesMenuDesktop({ buttonClassName }: DesktopProps) {
  return <HeaderNavGroupMenuDesktop group={RAFFLES_NAV_GROUP} buttonClassName={buttonClassName} />
}

type MobileProps = {
  onNavigate: () => void
}

/** Mobile sheet: grouped raffles + partner links at the top. */
export function HeaderRafflesMenuMobile({ onNavigate }: MobileProps) {
  return <HeaderNavGroupMenuMobile group={RAFFLES_NAV_GROUP} onNavigate={onNavigate} />
}

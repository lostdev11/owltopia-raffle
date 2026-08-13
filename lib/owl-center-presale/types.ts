import type { OwlCenterPresaleApprovalStatus } from '@/lib/owl-center-presale/constants'

export type OwlCenterPresalePreviewImage = {
  url: string
  alt: string
  fit?: 'contain' | 'cover'
}

export type OwlCenterPresaleTheme = {
  primary: string
  accent: string
  background: string
  surface: string
  muted: string
}

export type OwlCenterPresaleTenantPublic = {
  slug: string
  display_name: string
  headline: string | null
  description: string | null
  theme: OwlCenterPresaleTheme
  preview_images: OwlCenterPresalePreviewImage[]
}

export type OwlCenterPresaleStats = OwlCenterPresaleTenantPublic & {
  tenant_id: string
  presale_supply: number
  sold: number
  remaining: number
  percent_sold: number
  unit_price_usdc: number
  /** Spot + platform fee per unit (buyer total). */
  unit_lamports: string | null
  unit_partner_lamports?: string | null
  unit_platform_fee_lamports?: string | null
  platform_fee_usdc_per_spot?: number
  sol_usd_price: number | null
  presale_live: boolean
  presale_enabled: boolean
  presale_sold_out: boolean
  purchases_open: boolean
  max_spots_per_purchase: number
  max_credits_per_wallet: number
  sold_sync_unavailable?: boolean
}

export type OwlCenterPresaleBalance = {
  tenant_id: string
  wallet: string
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
}

export type OwlCenterPresaleTenantAdmin = {
  id: string
  slug: string
  display_name: string
  headline: string | null
  description: string | null
  treasury_wallet: string
  partner_wallet: string | null
  is_enabled: boolean
  is_live: boolean
  approval_status: OwlCenterPresaleApprovalStatus
  created_by_wallet: string | null
  rejection_reason: string | null
  unit_price_usdc: number
  presale_supply: number
  max_spots_per_purchase: number
  max_credits_per_wallet: number
  theme: OwlCenterPresaleTheme
  preview_images: OwlCenterPresalePreviewImage[]
  sort_order: number
  updated_by_wallet: string | null
  created_at: string
  updated_at: string
  sold?: number
  remaining?: number
}

export type OwlCenterPresaleListItem = {
  slug: string
  display_name: string
  headline: string | null
  is_live: boolean
  theme: Pick<OwlCenterPresaleTheme, 'primary' | 'accent'>
  presale_url: string
}

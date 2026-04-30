import type { RaffleCurrency } from '@/lib/types'

export const CART_STORAGE_KEY = 'owl-raffle-cart-v1'

export type CartLineSnapshot = {
  title: string
  slug: string
  currency: RaffleCurrency | string
  ticket_price: number
  /** Listing artwork for cart UI (optional in persisted carts from before this field existed). */
  image_url?: string | null
  image_fallback_url?: string | null
}

/** One raffle + ticket count; snapshot is UI-only until checkout refreshes from API */
export type CartLine = {
  raffleId: string
  quantity: number
  addedAt: number
  snapshot: CartLineSnapshot
}

export type CartState = {
  lines: CartLine[]
}

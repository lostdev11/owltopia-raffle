import type { Metadata } from 'next'
import { PLATFORM_NAME } from '@/lib/site-config'
import { CartPageClient } from '@/components/cart/CartPageClient'

export const metadata: Metadata = {
  title: `Cart · ${PLATFORM_NAME}`,
  description: 'Review raffle tickets in your cart and add more live raffles before checkout.',
}

export default function CartPage() {
  return <CartPageClient />
}

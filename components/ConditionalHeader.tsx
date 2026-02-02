'use client'

import { usePathname } from 'next/navigation'
import { Header } from '@/components/Header'

/**
 * Renders the header only when the user is not on the home page.
 * On "/" we show a clean landing (Enter Owl Topia); header appears after they hit "Enter Raffles".
 */
export function ConditionalHeader() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <Header />
}

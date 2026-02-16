'use client'

import { usePathname } from 'next/navigation'
import { Header } from '@/components/Header'

/**
 * Renders the header only when the user is not on the home page.
 * Home redirects to /raffles, so header is shown on the main raffles view.
 */
export function ConditionalHeader() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <Header />
}

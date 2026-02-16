'use client'

import { usePathname } from 'next/navigation'
import { Footer } from '@/components/Footer'

/**
 * Renders the footer only when the user is not on the home page.
 */
export function ConditionalFooter() {
  const pathname = usePathname()
  if (pathname === '/') return null
  return <Footer />
}

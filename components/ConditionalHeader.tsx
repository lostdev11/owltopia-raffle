'use client'

import { Header } from '@/components/Header'

/**
 * Site header on every route (including `/`) so branding and wallet connect stay visible on mobile.
 */
export function ConditionalHeader() {
  return <Header />
}

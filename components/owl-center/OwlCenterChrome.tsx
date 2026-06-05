'use client'

import type { ReactNode } from 'react'

import { OwlCenterNav } from '@/components/owl-center/OwlCenterNav'
import { OwlCenterViewProvider } from '@/components/owl-center/OwlCenterViewProvider'

/** Shared Owl Center chrome: sticky section nav + wallet connect on every route. */
export function OwlCenterChrome({ children }: { children: ReactNode }) {
  return (
    <OwlCenterViewProvider>
      <div className="min-h-[100dvh] bg-[#0F1419] text-[#E8EEF2]">
        <OwlCenterNav />
        {children}
      </div>
    </OwlCenterViewProvider>
  )
}

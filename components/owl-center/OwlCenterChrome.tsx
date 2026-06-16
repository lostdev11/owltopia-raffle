'use client'

import type { ReactNode } from 'react'

import { OwlCenterNav } from '@/components/owl-center/OwlCenterNav'
import { OwlCenterViewProvider } from '@/components/owl-center/OwlCenterViewProvider'

function OwlCenterChromeInner({ children }: { children: ReactNode }) {
  return (
    <div
      data-owl-center-root
      className="min-h-[100dvh] w-full min-w-0 max-w-[100dvw] overflow-x-clip bg-[#0F1419] text-[#E8EEF2]"
    >
      <OwlCenterNav />
      {children}
    </div>
  )
}

/** Shared Owl Center chrome: public nav for everyone; admins see extra items in Admin view. */
export function OwlCenterChrome({ children }: { children: ReactNode }) {
  return (
    <OwlCenterViewProvider>
      <OwlCenterChromeInner>{children}</OwlCenterChromeInner>
    </OwlCenterViewProvider>
  )
}

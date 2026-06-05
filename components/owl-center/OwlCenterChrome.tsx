'use client'

import type { ReactNode } from 'react'

import { OwlCenterNav } from '@/components/owl-center/OwlCenterNav'
import { OwlCenterViewProvider, useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'

function OwlCenterChromeInner({ children }: { children: ReactNode }) {
  const { showAdminFeatures } = useOwlCenterView()

  return (
    <div className="min-h-[100dvh] bg-[#0F1419] text-[#E8EEF2]">
      {showAdminFeatures ? <OwlCenterNav /> : null}
      {children}
    </div>
  )
}

/** Shared Owl Center chrome: launchpad sub-nav only when an admin toggles Admin view. */
export function OwlCenterChrome({ children }: { children: ReactNode }) {
  return (
    <OwlCenterViewProvider>
      <OwlCenterChromeInner>{children}</OwlCenterChromeInner>
    </OwlCenterViewProvider>
  )
}

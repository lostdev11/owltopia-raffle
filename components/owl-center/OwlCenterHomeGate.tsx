'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { OWL_CENTER_HOLDER_HOME } from '@/lib/owl-center/view-mode'

/** Launchpad hub — admins in Admin view only. Holders redirect to Gen2 mint. */
export function OwlCenterHomeGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { adminLoading, showAdminFeatures } = useOwlCenterView()

  useEffect(() => {
    if (adminLoading || showAdminFeatures) return
    router.replace(OWL_CENTER_HOLDER_HOME)
  }, [adminLoading, showAdminFeatures, router])

  if (adminLoading) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title="Owl Center" subtitle="Loading…">
        <p className="font-mono text-sm text-[#5C6773]">Checking access…</p>
      </OwlCenterShell>
    )
  }

  if (!showAdminFeatures) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title="Owl Center" subtitle="Opening Gen2 mint…">
        <p className="font-mono text-sm text-[#5C6773]">Redirecting…</p>
      </OwlCenterShell>
    )
  }

  return <>{children}</>
}

'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Shield } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { OWL_CENTER_HOLDER_HOME } from '@/lib/owl-center/view-mode'

type OwlCenterAdminGateProps = {
  children: ReactNode
  title: string
  subtitle?: string
}

export function OwlCenterAdminGate({ children, title, subtitle }: OwlCenterAdminGateProps) {
  const { adminLoading, isOwlCenterAdmin, showAdminFeatures, setViewMode } = useOwlCenterView()

  if (adminLoading) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title={title} subtitle={subtitle ?? 'Loading…'}>
        <p className="font-mono text-sm text-[#5C6773]">Checking access…</p>
      </OwlCenterShell>
    )
  }

  if (!isOwlCenterAdmin) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title={title} subtitle="This area is not available yet.">
        <p className="max-w-lg text-sm text-[#9BA8B4]">
          Launchpad tools are for Owl Vision admins only. Gen2 mint and presale stay on the holder console.
        </p>
        <Link
          href={OWL_CENTER_HOLDER_HOME}
          className="mt-6 inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-5 text-sm font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/16"
        >
          Go to Gen2 mint
        </Link>
      </OwlCenterShell>
    )
  }

  if (!showAdminFeatures) {
    return (
      <OwlCenterShell
        eyebrow="OWL_CENTER // ADMIN"
        title={title}
        subtitle="Launchpad tools are hidden while you preview the holder experience."
      >
        <div className="max-w-lg space-y-4 text-sm text-[#9BA8B4]">
          <p>
            You are previewing what holders see — Gen2 mint without launchpad nav or admin tools. Switch to{' '}
            <strong className="font-normal text-[#E8EEF2]">Admin</strong> in{' '}
            <Link href="/admin/owl-center" className="text-[#00C97A] hover:underline">
              Owl Vision → Owl Center admin
            </Link>{' '}
            to open the hub, generator, and collection submit flow.
          </p>
          <DeployButton className="gap-2" onClick={() => setViewMode('admin')}>
            <Shield className="h-4 w-4" aria-hidden />
            Switch to Admin view
          </DeployButton>
        </div>
      </OwlCenterShell>
    )
  }

  return <>{children}</>
}

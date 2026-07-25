'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { HeartHandshake, Shield } from 'lucide-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { OWL_CENTER_HOLDER_HOME } from '@/lib/owl-center/view-mode'

type OwlCenterAdminGateProps = {
  children: ReactNode
  title: string
  subtitle?: string
  /** Also let approved launchpad partners through (launch wizard, generator). */
  allowPartners?: boolean
}

export function OwlCenterAdminGate({ children, title, subtitle, allowPartners = false }: OwlCenterAdminGateProps) {
  const {
    adminLoading,
    isOwlCenterAdmin,
    isLaunchpadPartner,
    isPartnerPreview,
    showAdminFeatures,
    showLaunchTools,
    setViewMode,
  } = useOwlCenterView()

  if (adminLoading) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title={title} subtitle={subtitle ?? 'Loading…'}>
        <p className="font-mono text-sm text-[#5C6773]">Checking access…</p>
      </OwlCenterShell>
    )
  }

  // Approved partners skip the admin view-mode machinery entirely.
  if (allowPartners && !isOwlCenterAdmin && isLaunchpadPartner) {
    return <>{children}</>
  }

  if (!isOwlCenterAdmin) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER" title={title} subtitle="This area is not available yet.">
        <p className="max-w-lg text-sm text-[#9BA8B4]">
          {allowPartners
            ? 'Launchpad tools are for approved partners and Owl Vision admins. Want to launch a collection with us? Apply to the partner program and we will set up your wallet.'
            : 'Launchpad tools are for Owl Vision admins only. Gen2 mint and collection pages stay on the holder console.'}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {allowPartners ? (
            <Link
              href="/partner-program"
              className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-5 text-sm font-bold uppercase tracking-wide text-[#E8FDF4] hover:bg-[#00FF9C]/16"
            >
              Apply to partner program
            </Link>
          ) : null}
          <Link
            href={OWL_CENTER_HOLDER_HOME}
            className={`inline-flex min-h-[44px] touch-manipulation items-center px-5 text-sm font-bold uppercase tracking-wide ${
              allowPartners
                ? 'border border-[#1A222B] text-[#9BA8B4] hover:border-[#00FF9C]/35 hover:text-[#00FF9C]'
                : 'border border-[#00FF9C]/35 bg-[#00FF9C]/10 text-[#E8FDF4] hover:bg-[#00FF9C]/16'
            }`}
          >
            Back to Owl Center
          </Link>
        </div>
      </OwlCenterShell>
    )
  }

  // Partner preview + Admin both get launch tools when allowPartners (generator / submit).
  if (allowPartners && showLaunchTools) {
    return <>{children}</>
  }

  // Admin-only routes (no partner access): require full admin view.
  if (!allowPartners && showAdminFeatures) {
    return <>{children}</>
  }

  if (isPartnerPreview && !allowPartners) {
    return (
      <OwlCenterShell
        eyebrow="OWL_CENTER // PARTNER PREVIEW"
        title={title}
        subtitle="This page is admin-only — switch to Admin view."
      >
        <div className="max-w-lg space-y-4 text-sm text-[#9BA8B4]">
          <p>
            Partner preview shows what approved partners can open. This tool is admin-only — switch to{' '}
            <strong className="font-normal text-[#E8EEF2]">Admin</strong> to continue.
          </p>
          <DeployButton className="gap-2" onClick={() => setViewMode('admin')}>
            <Shield className="h-4 w-4" aria-hidden />
            Switch to Admin view
          </DeployButton>
        </div>
      </OwlCenterShell>
    )
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // ADMIN"
      title={title}
      subtitle="Launchpad tools are hidden while you preview the holder experience."
    >
      <div className="max-w-lg space-y-4 text-sm text-[#9BA8B4]">
        <p>
          You are previewing what holders see — mint and drops without launchpad nav. Switch to{' '}
          <strong className="font-normal text-[#E8EEF2]">Partner</strong> (partner UX) or{' '}
          <strong className="font-normal text-[#E8EEF2]">Admin</strong> (operator tools) in{' '}
          <Link href="/admin/owl-center" className="text-[#00C97A] hover:underline">
            Owl Vision → Owl Center admin
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-3">
          {allowPartners ? (
            <DeployButton className="gap-2" onClick={() => setViewMode('partner')}>
              <HeartHandshake className="h-4 w-4" aria-hidden />
              Partner preview
            </DeployButton>
          ) : null}
          <DeployButton className="gap-2" onClick={() => setViewMode('admin')}>
            <Shield className="h-4 w-4" aria-hidden />
            Switch to Admin view
          </DeployButton>
        </div>
      </div>
    </OwlCenterShell>
  )
}

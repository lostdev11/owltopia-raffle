'use client'

import Link from 'next/link'
import { ArrowRight, ExternalLink } from 'lucide-react'

import { GOMT_LABZ_STAKING_URL } from '@/lib/nesting/nft-stake-eligibility'
import {
  GOMT_MIGRATION_OPTIONAL,
  GOMT_RESTAKE_REQUIRED_IF_CONTINUING,
} from '@/lib/nesting/gomt-migration-copy'

/**
 * Holder-facing notice: staking moved from GOMT Labz to Owltopia Nesting.
 * Shown on public nesting landing and dashboard until migration window closes.
 */
export function NestingGomtMigrationNotice() {
  return (
    <div
      className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.08] px-4 py-3 text-sm text-foreground"
      role="status"
    >
      <p className="font-medium text-foreground">Staking now lives on Owltopia</p>
      <p className="mt-1 text-muted-foreground leading-relaxed">{GOMT_MIGRATION_OPTIONAL}</p>
      <p className="mt-2 text-muted-foreground leading-relaxed">
        If you want to keep nesting and your owl is still on{' '}
        <a
          href={GOMT_LABZ_STAKING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-emerald-400 hover:text-emerald-300 underline-offset-4 hover:underline touch-manipulation min-h-[44px]"
        >
          GOMT Labz
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </a>
        , finish there first: <span className="font-medium text-foreground/90">unstake</span> or wait until your lock
        period ends. {GOMT_RESTAKE_REQUIRED_IF_CONTINUING}
      </p>
      <p className="mt-2 text-muted-foreground leading-relaxed">
        On mobile, connect your wallet in the header, open{' '}
        <Link
          href="/dashboard/nesting"
          className="inline-flex items-center gap-1 font-medium text-emerald-400 hover:text-emerald-300 underline-offset-4 hover:underline touch-manipulation min-h-[44px]"
        >
          My nest
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Link>{' '}
        to pick a perch and complete the nest flow.
      </p>
    </div>
  )
}

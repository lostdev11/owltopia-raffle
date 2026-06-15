'use client'

import Link from 'next/link'

import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import {
  getLaunchMarketplaceProgress,
  type LaunchMarketplaceProgress,
} from '@/lib/owl-center/launch-marketplace-eligibility'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const PANEL_LABEL = 'MARKETPLACE_INDEXING · TRADING_ACTIVATION'

type Step = { label: string; detail: string; automated?: boolean }

const AUTOMATED_STEPS: Step[] = [
  {
    label: 'Hash list generated',
    detail: 'All mint addresses collected automatically at sell-out.',
    automated: true,
  },
  {
    label: 'Suggested marketplace URLs saved',
    detail: 'Magic Eden and Tensor links prefilled from your collection mint.',
    automated: true,
  },
]

const MANUAL_STEPS: Step[] = [
  {
    label: 'Submit hash list on Magic Eden',
    detail: 'Creator Hub — ME has no public auto-upload API, so this step is manual.',
  },
  {
    label: 'Verify on Tensor',
    detail: 'Confirm your collection mint in Tensor creator tools.',
  },
  {
    label: 'Paste live URLs and go live',
    detail: 'Return here after indexing to show trade buttons on your mint page.',
  },
]

function ProgressBar({ progress }: { progress: LaunchMarketplaceProgress }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-2 font-mono text-xs">
        <span className="text-[#9BA8B4]">Mint progress</span>
        <span className="text-[#E8FDF4]">
          {progress.minted} / {progress.total} minted
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#1A222B]">
        <div
          className="h-full bg-[#00FF9C] transition-[width] duration-500"
          style={{ width: `${Math.min(100, progress.percent_minted)}%` }}
        />
      </div>
      <p className="mt-2 font-mono text-[10px] text-[#5C6773]">
        Listing tools unlock when supply is fully minted ({progress.remaining} remaining).
      </p>
    </div>
  )
}

function StepList({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <div className="border border-[#1A222B] bg-[#0F1419]/70 p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">{title}</p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.label} className="flex gap-3 text-sm">
            <span className="mt-0.5 font-mono text-[10px] text-[#5C6773]">{i + 1}.</span>
            <div>
              <p className="text-[#C5D0D8]">
                {step.label}
                {step.automated ? (
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-[#00C97A]">auto</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#5C6773]">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function CreatorMarketplaceLockedSection({
  launch,
  embedded,
}: {
  launch: OwlCenterLaunchPublic
  embedded?: boolean
}) {
  const progress = getLaunchMarketplaceProgress(launch)
  const mintPageHref = `/owl-center/collection/${encodeURIComponent(launch.slug)}`

  const body = (
    <>
      <p className="mb-4 text-sm leading-relaxed text-[#C5D0D8]">
        Secondary listing is a <strong className="font-normal text-[#EAFBF4]">post–sell-out</strong> step. Owl Center
        automates what it can; Magic Eden and Tensor still require one-time manual verification.
      </p>

      <ProgressBar progress={progress} />

      <div className="space-y-4">
        <StepList title="Automated at sell-out" steps={AUTOMATED_STEPS} />
        <StepList title="Your steps after sell-out" steps={MANUAL_STEPS} />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[#5C6773]">
        Share your{' '}
        <Link href={mintPageHref} className="text-[#00FF9C] underline">
          mint page
        </Link>{' '}
        while mint is live. This section unlocks automatically when the last piece mints — no extra setup needed.
      </p>
    </>
  )

  if (embedded) {
    return <CommandCardSection label={PANEL_LABEL}>{body}</CommandCardSection>
  }

  return body
}

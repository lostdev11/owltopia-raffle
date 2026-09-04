'use client'

import { useEffect, useMemo, useState } from 'react'

import { CommandCardSection } from '@/components/owl-center/CommandCardSection'
import { creatorWlWalletsApiPath } from '@/lib/owl-center/creator-api-paths'
import {
  buildCreatorLaunchSetupChecklist,
  creatorSetupChecklistProgress,
  type CreatorSetupStepStatus,
} from '@/lib/owl-center/creator-launch-setup-checklist'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function statusLabel(status: CreatorSetupStepStatus): string {
  switch (status) {
    case 'done':
      return 'Done'
    case 'waiting':
      return 'When ready'
    case 'skipped':
      return 'Skipped'
    default:
      return 'To do'
  }
}

function statusClass(status: CreatorSetupStepStatus): string {
  switch (status) {
    case 'done':
      return 'text-[#00FF9C]'
    case 'waiting':
      return 'text-[#FFD769]'
    case 'skipped':
      return 'text-[#5C6773]'
    default:
      return 'text-[#9BA8B4]'
  }
}

type Props = {
  launchId: string
  launch: OwlCenterLaunchPublic
}

export function CreatorLaunchSetupChecklist({ launchId, launch }: Props) {
  const needsWalletCount = launchHasWhitelistProgram(launch)
  const [walletCount, setWalletCount] = useState<number | null>(null)

  useEffect(() => {
    if (!needsWalletCount) {
      setWalletCount(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(creatorWlWalletsApiPath(launchId), {
          credentials: 'include',
          cache: 'no-store',
        })
        const j = (await res.json()) as { wallet_count?: number; rows?: unknown[] }
        if (cancelled) return
        if (!res.ok) {
          setWalletCount(null)
          return
        }
        setWalletCount(j.wallet_count ?? j.rows?.length ?? 0)
      } catch {
        if (!cancelled) setWalletCount(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [launchId, needsWalletCount, launch.partner_allowlist_phases, launch.creator_wl_enabled, launch.wl_supply])

  const steps = useMemo(
    () =>
      buildCreatorLaunchSetupChecklist({
        launch,
        allowlistWalletCount: needsWalletCount ? walletCount : 0,
      }),
    [launch, needsWalletCount, walletCount]
  )
  const { requiredDone, requiredTotal } = creatorSetupChecklistProgress(steps)

  return (
    <CommandCardSection first id="launch-setup" label="LAUNCH SETUP">
      <p className="mb-4 text-sm leading-relaxed text-[#9BA8B4]">
        Follow these steps in order. Jump to a section anytime — save mint details before uploading wallets.
      </p>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
        Progress · {requiredDone}/{requiredTotal} ready
      </p>
      <ol className="grid gap-2">
        {steps.map((step) => (
          <li key={step.id}>
            <a
              href={step.href}
              className="flex flex-wrap items-start justify-between gap-2 border border-[#1A222B] bg-[#0F1419]/80 px-3 py-3 transition hover:border-[#2A343F]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11px] font-bold uppercase tracking-widest text-[#E8EEF2]">
                  {step.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[#9BA8B4]">{step.hint}</span>
              </span>
              <span className={`shrink-0 font-mono text-[10px] uppercase tracking-widest ${statusClass(step.status)}`}>
                {statusLabel(step.status)}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </CommandCardSection>
  )
}

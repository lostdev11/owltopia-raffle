'use client'

import { Loader2 } from 'lucide-react'

import {
  isMintInProgress,
  mintProgressHeading,
  mintProgressSubtext,
  type MintProgressSnapshot,
  type MintUiStep,
} from '@/lib/owl-center/mint-ui-steps'

export type MintProgressOverlayProps = {
  open: boolean
  step: MintUiStep
  progress?: MintProgressSnapshot | null
}

export function MintProgressOverlay({ open, step, progress = null }: MintProgressOverlayProps) {
  if (!open || !isMintInProgress(step)) return null

  const heading = mintProgressHeading(step, progress)
  const subtext = mintProgressSubtext(step, progress)
  const showBar = progress != null && progress.phase === 'chain' && progress.total > 1 && progress.current > 0
  const barPct = showBar ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : null

  return (
    <div
      className="mint-reveal-backdrop fixed inset-0 z-[199] flex items-center justify-center bg-[#0B0F14]/92 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="mint-progress-overlay-title"
    >
      <div className="mint-reveal-dialog relative w-full max-w-md space-y-5 overflow-hidden border border-[#1A222B] bg-[#0F1419] p-6 text-center shadow-[0_0_40px_rgba(0,255,156,0.08)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[#00FF9C]/30 bg-[#00FF9C]/10">
          <Loader2 className="h-8 w-8 animate-spin text-[#00FF9C]" aria-hidden />
        </div>

        <div className="space-y-2">
          <h2 id="mint-progress-overlay-title" className="text-lg font-semibold text-[#E8EEF2]">
            {heading}
          </h2>
          <p className="text-sm leading-relaxed text-[#9BA8B4]">{subtext}</p>
        </div>

        {showBar && barPct != null ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-[#1A222B]">
              <div
                className="h-full rounded-full bg-[#00FF9C] transition-[width] duration-500 ease-out"
                style={{ width: `${barPct}%` }}
              />
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#5C6773]">
              {progress.current} / {progress.total}
            </p>
          </div>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00FF9C]">Please wait</p>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PackOpeningExperience,
  type PackOpeningStage,
} from '@/components/packs/PackOpeningExperience'
import { PackHoverVideo } from '@/components/packs/PackHoverVideo'
import { preloadPackAnimationVideos } from '@/lib/packs/animations'
import type { PackOpenClientResult } from '@/lib/client/execute-pack-purchase'

function mockReward(category: 'owl' | 'sol' | 'nft'): PackOpenClientResult {
  if (category === 'sol') {
    return {
      openId: '00000000-0000-4000-8000-000000000001',
      category: 'sol',
      prizeLabel: '0.1 SOL',
      owlAmount: null,
      solAmount: 0.1,
      nftMint: null,
      nftName: null,
      nftImageUrl: null,
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'dev-preview-seed',
      openCommitHash: 'dev-preview-commit',
      revealMessage: 'You won 0.1 SOL (dev preview)',
    }
  }
  if (category === 'nft') {
    return {
      openId: '00000000-0000-4000-8000-000000000002',
      category: 'nft',
      prizeLabel: 'Preview Owl NFT',
      owlAmount: null,
      solAmount: null,
      nftMint: 'Prev1ew111111111111111111111111111111111111',
      nftName: 'Preview Owl NFT',
      nftImageUrl: '/logo.gif',
      freeTicketCredits: 0,
      payoutSignature: null,
      openSeed: 'dev-preview-seed',
      openCommitHash: 'dev-preview-commit',
      revealMessage: 'You won Preview Owl NFT (dev preview)',
    }
  }
  return {
    openId: '00000000-0000-4000-8000-000000000003',
    category: 'owl',
    prizeLabel: '25 $OWL',
    owlAmount: 25,
    solAmount: null,
    nftMint: null,
    nftName: null,
    nftImageUrl: null,
    freeTicketCredits: 25,
    payoutSignature: null,
    openSeed: 'dev-preview-seed',
    openCommitHash: 'dev-preview-commit',
    revealMessage: 'You have won 25 free tickets on raffle site (dev preview)',
  }
}

type Mode = 'hovering' | 'opening' | 'full' | 'reveal'

export function DevPackOpeningClient() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [category, setCategory] = useState<'owl' | 'sol' | 'nft'>('nft')
  const [runKey, setRunKey] = useState(0)

  const reward = useMemo(() => mockReward(category), [category])

  useEffect(() => {
    preloadPackAnimationVideos()
  }, [])

  const experienceProps = useMemo(() => {
    if (!mode) return null
    if (mode === 'hovering') {
      return {
        initialStage: 'hovering' as PackOpeningStage,
        includeHoverGate: true,
        hoverOnly: true,
      }
    }
    if (mode === 'opening') {
      return {
        initialStage: 'opening' as PackOpeningStage,
        includeHoverGate: false,
        hoverOnly: false,
      }
    }
    if (mode === 'reveal') {
      return {
        initialStage: 'whiteTransition' as PackOpeningStage,
        includeHoverGate: false,
        hoverOnly: false,
      }
    }
    return {
      initialStage: 'hovering' as PackOpeningStage,
      includeHoverGate: true,
      hoverOnly: false,
    }
  }, [mode])

  return (
    <div className="min-h-[100dvh] bg-[#050807] px-4 py-8 text-[#EAFBF4]">
      <div className="mx-auto max-w-lg space-y-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200/90">
            Dev only
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-wide">Pack opening preview</h1>
          <p className="mt-2 text-sm text-[#A9CBB9]">
            Mock rewards only. Production purchases always use real open results.
          </p>
        </div>

        <label className="block text-sm text-[#A9CBB9]">
          Mock prize category
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-[#EAFBF4]"
            value={category}
            onChange={(e) => setCategory(e.target.value as 'owl' | 'sol' | 'nft')}
          >
            <option value="nft">NFT</option>
            <option value="sol">SOL</option>
            <option value="owl">$OWL</option>
          </select>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['hovering', 'Hovering only'],
              ['opening', 'Opening only'],
              ['full', 'Full sequence'],
              ['reveal', 'Reward reveal'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id)
                setRunKey((k) => k + 1)
              }}
              className="min-h-[48px] rounded-xl border border-[#00FF9C]/35 bg-[#00FF9C]/10 px-4 text-sm font-semibold uppercase tracking-wider text-[#00FF9C] hover:bg-[#00FF9C]/20"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-white/40">
            On-page hover (packs hero)
          </p>
          <PackHoverVideo phase="idle" />
        </div>
      </div>

      {mode && experienceProps ? (
        <PackOpeningExperience
          key={`${mode}-${category}-${runKey}`}
          reward={reward}
          includeHoverGate={experienceProps.includeHoverGate}
          hoverOnly={experienceProps.hoverOnly}
          initialStage={experienceProps.initialStage}
          onComplete={() => setMode(null)}
        />
      ) : null}
    </div>
  )
}

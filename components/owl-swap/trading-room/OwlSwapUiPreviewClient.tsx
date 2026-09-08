'use client'

import { useState } from 'react'
import { OwlSwapTradingRoom } from '@/components/owl-swap/trading-room/OwlSwapTradingRoom'
import { OwlSwapMissingEscrowAlert } from '@/components/owl-swap/trading-room/OwlSwapMissingEscrowAlert'
import type { OwlSwapTxUiState } from '@/lib/owl-swap/trading-room-ui-state'

const SAMPLE_OFFER = [
  {
    mint: 'OfferMint1111111111111111111111111111111',
    name: 'Sample Owl A',
    imageUrl: 'https://picsum.photos/seed/owlswap-offer/512/512',
    collection: 'Owltopia',
  },
]

const SAMPLE_RECEIVE = [
  {
    mint: 'RecvMint11111111111111111111111111111111',
    name: 'Sample Owl B',
    imageUrl: 'https://picsum.photos/seed/owlswap-recv/512/512',
    collection: 'Owltopia',
  },
]

export function OwlSwapUiPreviewClient() {
  const [txState, setTxState] = useState<OwlSwapTxUiState>('idle_review')
  const [mode, setMode] = useState<'create' | 'accept'>('create')
  const [showMissingEscrow, setShowMissingEscrow] = useState(true)

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-6 sm:px-4 sm:py-10">
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
        OwlSwap UI preview (OWL_SWAP_UI_PREVIEW) — sample art for layout QA only. Not a live swap.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-white/20 px-3 text-sm touch-manipulation"
          onClick={() => setMode('create')}
        >
          Create layout
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-white/20 px-3 text-sm touch-manipulation"
          onClick={() => setMode('accept')}
        >
          Accept layout
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-white/20 px-3 text-sm touch-manipulation"
          onClick={() => setTxState('pending_confirmation')}
        >
          Pending state
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-white/20 px-3 text-sm touch-manipulation"
          onClick={() => setTxState('idle_review')}
        >
          Idle
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-md border border-white/20 px-3 text-sm touch-manipulation"
          onClick={() => setShowMissingEscrow((v) => !v)}
        >
          {showMissingEscrow ? 'Hide escrow alert' : 'Show escrow alert'}
        </button>
      </div>
      {showMissingEscrow ? <OwlSwapMissingEscrowAlert /> : null}
      <OwlSwapTradingRoom
        mode={mode}
        offerAssets={SAMPLE_OFFER}
        receiveAssets={mode === 'accept' ? SAMPLE_RECEIVE : []}
        txState={txState}
        feeSolLabel="0.02 SOL"
        feeAvailable
        ctaLabel={mode === 'create' ? 'Create offer & deposit →' : 'Accept & pay 0.02 SOL →'}
        ctaDisabled={txState !== 'idle_review'}
        onPrimary={() => setTxState('awaiting_signature')}
        onChangeOffer={() => {}}
        receiveEmptyCopy="Awaiting counterparty"
      />
    </div>
  )
}

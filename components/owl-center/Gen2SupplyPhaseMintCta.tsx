'use client'

import { useMemo } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { DeployButton } from '@/components/owl-center/DeployButton'
import { useGen2MintEligibility } from '@/hooks/use-gen2-mint-eligibility'
import {
  owlCenterMintPhaseStatusLabel,
  owlCenterMintWrongPhaseHint,
} from '@/lib/owl-center/phase-display'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { getGen2CandyMachineId, getGen2CollectionMint } from '@/lib/solana/network'
import { cn } from '@/lib/utils'

type Props = {
  launch: OwlCenterLaunchPublic
  remaining: number
  presaleSoldOut?: boolean
  mintControls: OwlCenterMintControls
}

export function Gen2SupplyPhaseMintCta({ launch, remaining, presaleSoldOut = false, mintControls }: Props) {
  const { connected, publicKey } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const { elig, loading: eligLoading } = useGen2MintEligibility(wallet, connected)

  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || remaining <= 0
  const mintClosed = trading || soldOut
  const cmConfigured = Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())

  const canMint =
    !mintControls.disabled &&
    !mintClosed &&
    connected &&
    cmConfigured &&
    elig?.is_eligible === true

  const disabledReason = useMemo(() => {
    if (mintControls.env_kill_switch) {
      return 'Mint is paused for maintenance (deployment kill switch).'
    }
    if (mintControls.admin_paused) {
      return 'Mint is temporarily paused by Owl Center.'
    }
    if (trading) return 'Trading is active — primary mint is closed.'
    if (soldOut) return 'Primary supply is sold out.'
    if (!cmConfigured) return 'Mint infrastructure is not fully configured yet.'
    if (!connected) return 'Connect your wallet in the header to mint.'
    if (eligLoading || !elig) return 'Checking your allocation…'
    if (!elig.is_eligible) {
      return (
        owlCenterMintWrongPhaseHint({
          activePhase: launch.active_phase,
          presaleSoldOut,
          isGen1Holder: elig.gen1_snapshot?.is_holder === true,
        }) ?? 'Not eligible to mint in the current phase — see Allocation below.'
      )
    }
    return null
  }, [
    mintControls,
    trading,
    soldOut,
    cmConfigured,
    connected,
    eligLoading,
    elig,
    launch.active_phase,
    presaleSoldOut,
  ])

  const phaseLabel = elig
    ? owlCenterMintPhaseStatusLabel(elig.active_phase, { presaleSoldOut })
    : owlCenterMintPhaseStatusLabel(launch.active_phase, { presaleSoldOut })

  const scrollToMint = () => {
    document.getElementById('mint')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mt-6 border-t border-[#1A222B] pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 font-mono text-xs text-[#9BA8B4]">
          <p>
            {connected && elig && elig.is_eligible ? (
              <>
                Your mint phase: <span className="text-[#00FF9C]">{phaseLabel}</span>
                {' · '}
                Can mint <span className="text-[#F4FBF8]">{elig.max_mintable}</span> now
              </>
            ) : (
              <>
                Phase: <span className="text-[#00FF9C]">{phaseLabel}</span>
              </>
            )}
          </p>
          {disabledReason ? (
            <p className={cn('mt-1', mintControls.disabled ? 'text-[#FFD769]' : 'text-[#5C6773]')}>{disabledReason}</p>
          ) : (
            <p className="mt-1 text-[#5C6773]">Open the mint console below to sign in your wallet app.</p>
          )}
        </div>
        <DeployButton
          type="button"
          disabled={!canMint}
          onClick={() => scrollToMint()}
          className="w-full shrink-0 sm:w-auto"
          aria-describedby="gen2-supply-mint-hint"
        >
          Mint
        </DeployButton>
      </div>
      <p id="gen2-supply-mint-hint" className="sr-only">
        {canMint ? 'Scrolls to the mint console section' : disabledReason ?? 'Mint unavailable'}
      </p>
    </div>
  )
}

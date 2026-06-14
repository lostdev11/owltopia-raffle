'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import { useCollectionMintEligibility } from '@/hooks/use-collection-mint-eligibility'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { formatOwlCenterPlatformMintFeeLabel } from '@/lib/owl-center/platform-mint-fee'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  getLaunchCandyMachineId,
  getLaunchCollectionMint,
  resolveLaunchMintNetwork,
} from '@/lib/solana/launch-cm'
import { mintGen2FromCandyMachine } from '@/lib/solana/gen2-mint'
import { owlCenterSolanaExplorerTxUrl } from '@/lib/solana/network'

type MintUiStep =
  | 'idle'
  | 'preparing_mint'
  | 'awaiting_signature'
  | 'sending_transaction'
  | 'confirming_transaction'
  | 'recording_mint'
  | 'success'
  | 'error'

function stepLabel(s: MintUiStep): string {
  switch (s) {
    case 'preparing_mint':
      return 'PREPARING_MINT'
    case 'awaiting_signature':
      return 'AWAITING_SIGNATURE'
    case 'sending_transaction':
      return 'SENDING_TRANSACTION'
    case 'confirming_transaction':
      return 'CONFIRMING_TRANSACTION'
    case 'recording_mint':
      return 'RECORDING_MINT'
    case 'success':
      return 'SUCCESS'
    case 'error':
      return 'ERROR'
    default:
      return 'IDLE'
  }
}

export function CollectionMintPanel({
  slug,
  launch,
  remaining,
  mintControls,
  onRefresh,
}: {
  slug: string
  launch: OwlCenterLaunchPublic
  remaining: number
  mintControls: OwlCenterMintControls
  onRefresh: () => void
}) {
  const { publicKey, connected, wallet } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const adapter = wallet?.adapter
  const mintNetwork = resolveLaunchMintNetwork(launch)

  const [qty, setQty] = useState(1)
  const { elig, loading: eligLoading, refresh: loadElig } = useCollectionMintEligibility(slug, walletStr, connected)
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)

  const cmConfigured = Boolean(
    getLaunchCandyMachineId(launch, mintNetwork)?.trim() && getLaunchCollectionMint(launch, mintNetwork)?.trim()
  )

  const maxQ = useMemo(() => {
    if (!elig) return 1
    return Math.max(1, Math.min(elig.max_mintable, remaining, 10))
  }, [elig, remaining])

  useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), maxQ))
  }, [maxQ])

  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || remaining <= 0
  const mintClosed = trading || soldOut || mintControls.disabled

  const runMint = async () => {
    setErr(null)
    setLastSig(null)
    if (!connected || !walletStr || !adapter) {
      setErr('Connect your wallet (Phantom / Solflare on mobile)')
      setStep('error')
      return
    }
    if (!elig?.is_eligible) {
      setErr(elig?.reason ?? 'Not eligible')
      setStep('error')
      return
    }
    if (!cmConfigured) {
      setErr('Candy Machine not configured — admin must set CM + collection mint')
      setStep('error')
      return
    }

    const n = Math.min(qty, elig.max_mintable, remaining)
    try {
      for (let i = 0; i < n; i++) {
        setStep('preparing_mint')
        setStep('awaiting_signature')
        setStep('sending_transaction')
        const minted = await mintGen2FromCandyMachine({
          walletAdapter: adapter,
          candyMachineId: getLaunchCandyMachineId(launch, mintNetwork),
          collectionMint: getLaunchCollectionMint(launch, mintNetwork),
          quantity: 1,
          phase: 'PUBLIC',
          launch,
          mintNetwork,
        })
        if (!minted.ok) {
          throw new Error(minted.error || 'mint_failed')
        }
        const sig = minted.txSignatures[0]
        const mintPk = minted.mintedNftMints[0]
        setStep('confirming_transaction')
        setStep('recording_mint')
        const conf = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/confirm-mint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: walletStr,
            txSignature: sig,
            quantity: 1,
            phase: 'PUBLIC',
            mintedNftMints: mintPk ? [mintPk] : [],
            network: mintNetwork,
          }),
        })
        const cj = (await conf.json()) as { ok?: boolean; error?: string }
        if (!conf.ok || !cj.ok) {
          throw new Error(cj.error || 'confirm_failed')
        }
        setLastSig(sig)
      }
      setStep('success')
      await Promise.all([loadElig(), onRefresh()])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'mint_failed')
      setStep('error')
    }
  }

  const priceLabel = formatPhasePriceSolOrFree(elig?.unit_lamports_estimate ?? null, {
    paid: launch.public_price_usdc != null && launch.public_price_usdc > 0,
  })
  const platformFeeLabel = formatOwlCenterPlatformMintFeeLabel()

  if (trading) {
    return (
      <CommandCard label="TRADE // marketplaces">
        <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
      </CommandCard>
    )
  }

  return (
    <CommandCard label={`MINT // public · ${mintNetwork}`}>
      <div className="space-y-4">
        <p className="font-mono text-xs text-[#9BA8B4]">
          {priceLabel} · {platformFeeLabel} · limit {launch.wallet_mint_limit}/wallet/phase
          {elig && connected ? ` · you: ${elig.wallet_minted}/${elig.wallet_mint_limit}` : ''} · {remaining}{' '}
          remaining
        </p>

        {mintControls.env_kill_switch ? (
          <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Mint kill switch active — contact support.
          </p>
        ) : null}

        {soldOut ? (
          <p className="font-mono text-sm text-[#00FF9C]">SOLD OUT</p>
        ) : mintClosed ? (
          <p className="text-sm text-[#9BA8B4]">{elig?.reason ?? 'Mint unavailable'}</p>
        ) : (
          <>
            {!connected ? (
              <p className="text-sm text-[#9BA8B4]">Connect wallet to mint on {mintNetwork}.</p>
            ) : eligLoading ? (
              <p className="font-mono text-xs text-[#5C6773]">Checking eligibility…</p>
            ) : (
              <p className="text-sm text-[#C5D0D8]">{elig?.reason ?? (elig?.is_eligible ? 'Eligible to mint' : '—')}</p>
            )}

            {connected && elig?.is_eligible && maxQ > 1 ? (
              <label className="flex flex-col gap-2 text-sm text-[#C5D0D8]">
                Quantity
                <input
                  type="number"
                  min={1}
                  max={maxQ}
                  value={qty}
                  onChange={(e) => setQty(Math.min(maxQ, Math.max(1, Number(e.target.value) || 1)))}
                  className="min-h-[44px] w-24 touch-manipulation border border-[#1A222B] bg-[#0F1419] px-3 font-mono text-[#E8EEF2]"
                />
              </label>
            ) : null}

            <DeployButton
              className="w-full sm:w-auto"
              disabled={!connected || !elig?.is_eligible || step === 'recording_mint' || !cmConfigured}
              onClick={() => void runMint()}
            >
              {step !== 'idle' && step !== 'success' && step !== 'error' ? stepLabel(step) : 'Mint now'}
            </DeployButton>
          </>
        )}

        {step === 'success' && lastSig ? (
          <p className="font-mono text-xs text-[#00FF9C]">
            Mint recorded ·{' '}
            <a
              href={owlCenterSolanaExplorerTxUrl(lastSig, mintNetwork)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              View tx
            </a>
          </p>
        ) : null}

        {err ? <p className="text-sm text-red-400">{err}</p> : null}
      </div>
    </CommandCard>
  )
}

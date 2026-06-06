'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import {
  owlCenterMintPhaseStatusLabel,
  owlCenterMintWrongPhaseHint,
} from '@/lib/owl-center/phase-display'
import { owlCenterAllowsHighQuantityMint } from '@/lib/owl-center/phase-allowance'
import { useGen2MintEligibility } from '@/hooks/use-gen2-mint-eligibility'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { mintGen2FromCandyMachine } from '@/lib/solana/gen2-mint'
import {
  getGen2CandyMachineId,
  getGen2CollectionMint,
  isDevnetMintEnabled,
  owlCenterSolanaExplorerTxUrl,
} from '@/lib/solana/network'

export type MintUiStep =
  | 'idle'
  | 'checking_eligibility'
  | 'preparing_mint'
  | 'awaiting_signature'
  | 'sending_transaction'
  | 'confirming_transaction'
  | 'recording_mint'
  | 'success'
  | 'error'

function stepLabel(s: MintUiStep): string {
  switch (s) {
    case 'checking_eligibility':
      return 'CHECKING_ELIGIBILITY'
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

export function Gen2MintPanel({
  launch,
  remaining,
  presaleSoldOut = false,
  mintControls,
  onRefresh,
}: {
  launch: OwlCenterLaunchPublic
  remaining: number
  /** True when all presale purchase spots are claimed (distinct from Presale mint redemption phase). */
  presaleSoldOut?: boolean
  mintControls: OwlCenterMintControls
  onRefresh: () => void
}) {
  const { publicKey, connected, wallet } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const adapter = wallet?.adapter

  const [qty, setQty] = useState(1)
  const { elig, loading: eligLoading, refresh: loadElig } = useGen2MintEligibility(walletStr, connected)
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)

  const cmConfigured = Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())

  const maxQ = useMemo(() => {
    if (!elig) return 1
    const phaseCap = owlCenterAllowsHighQuantityMint(elig.active_phase)
      ? elig.max_mintable
      : Math.min(elig.max_mintable, 10)
    return Math.max(1, Math.min(phaseCap, remaining))
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
      setErr('Wallet not connected')
      setStep('error')
      return
    }
    if (!elig?.is_eligible) {
      setErr('Not eligible')
      setStep('error')
      return
    }
    if (!cmConfigured) {
      setErr('Candy Machine not configured — admin must set CM id + collection mint')
      setStep('error')
      return
    }

    const phase = elig.active_phase
    const allowedPhases = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC'] as const
    if (!allowedPhases.includes(phase as (typeof allowedPhases)[number])) {
      setErr('Mint not available in this phase')
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
          candyMachineId: getGen2CandyMachineId(launch),
          collectionMint: getGen2CollectionMint(launch),
          quantity: 1,
          phase,
          launch,
        })
        if (!minted.ok) {
          throw new Error(minted.error || 'mint_failed')
        }
        const sig = minted.txSignatures[0]
        const mintPk = minted.mintedNftMints[0]
        setStep('confirming_transaction')
        setStep('recording_mint')
        const conf = await fetch('/api/owl-center/gen2/confirm-mint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: walletStr,
            txSignature: sig,
            quantity: 1,
            phase,
            mintedNftMints: mintPk ? [mintPk] : [],
            network: isDevnetMintEnabled() ? 'devnet' : 'mainnet',
          }),
        })
        const cj = (await conf.json()) as { error?: string }
        if (!conf.ok) {
          throw new Error(cj.error || 'Confirm route failed')
        }
        setLastSig(sig)
      }
      setStep('success')
      onRefresh()
      void loadElig()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const low = msg.toLowerCase()
      if (low.includes('user rejected') || low.includes('cancel')) {
        setErr('Mint transaction rejected in wallet')
      } else if (low.includes('confirm route failed') || low.includes('confirm_failed')) {
        setErr('Transaction succeeded but database record failed — copy your signature from the wallet and contact support.')
      } else {
        setErr(msg)
      }
      setStep('error')
    }
  }

  if (trading) {
    return (
      <CommandCard label="trading.sys">
        <p className="text-sm text-[#9BA8B4]">Trading is now active — secondary markets only.</p>
        <div className="mt-4">
          <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
        </div>
      </CommandCard>
    )
  }

  if (soldOut) {
    return (
      <CommandCard label="sold_out.sys">
        <p className="font-mono text-lg font-bold text-[#FF9C9C]">SOLD OUT</p>
        <p className="mt-2 text-sm text-[#9BA8B4]">Primary mint supply exhausted. Awaiting or viewing trading activation.</p>
        <div className="mt-4">
          <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
        </div>
      </CommandCard>
    )
  }

  const phaseLabel = elig
    ? owlCenterMintPhaseStatusLabel(elig.active_phase, { presaleSoldOut })
    : '—'
  const wrongPhaseHint =
    elig && !elig.is_eligible
      ? owlCenterMintWrongPhaseHint({
          activePhase: launch.active_phase,
          presaleSoldOut,
          isGen1Holder: elig.gen1_snapshot?.is_holder === true,
        })
      : null

  return (
    <CommandCard label="mint_console">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A222B] pb-4">
          <div className="font-mono text-xs text-[#9BA8B4]">
            {eligLoading || !elig ? (
              <span>Checking live eligibility…</span>
            ) : (
              <span>
                {elig.is_eligible ? (
                  <>
                    Your mint phase: <span className="text-[#00FF9C]">{phaseLabel}</span>
                    {' · '}
                    Can mint <span className="text-[#F4FBF8]">{elig.max_mintable}</span> now
                  </>
                ) : (
                  <>
                    Active phase: <span className="text-[#00FF9C]">{phaseLabel}</span>
                    {' · '}
                    <span className="text-[#FFD769]">Not eligible to mint in this phase</span>
                  </>
                )}
                {' · '}
                <a href="#allocation" className="text-[#00FF9C] underline-offset-2 hover:underline">
                  View full allocation
                </a>
              </span>
            )}
          </div>
          {connected ? (
            <button
              type="button"
              onClick={() => void loadElig()}
              className="min-h-[44px] touch-manipulation font-mono text-[10px] uppercase tracking-widest text-[#00C97A] underline-offset-4 hover:underline"
            >
              Refresh
            </button>
          ) : (
            <p className="text-xs text-[#9BA8B4]">Connect in the site header to mint.</p>
          )}
        </div>

          {mintControls.env_kill_switch ? (
            <p className="border border-[#FFD769]/40 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
              Mint is paused for maintenance (deployment kill switch). Try again after the team clears{' '}
              <code className="text-[11px]">OWL_CENTER_MINT_DISABLED</code>.
            </p>
          ) : mintControls.admin_paused ? (
            <p className="border border-[#FFD769]/40 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
              Mint temporarily paused by Owl Center admin.
            </p>
          ) : null}

          {launch.active_phase === 'PRESALE' && elig?.presale_balance && !elig.presale_balance.is_paid_participant ? (
            <div className="space-y-2 border border-[#1A222B] bg-[#0F1419] p-3">
              <p className="text-sm text-[#9BA8B4]">
                This wallet is not in presale purchase records. Connect or link the wallet you used to pay during presale.
              </p>
            </div>
          ) : null}

          {launch.active_phase === 'PRESALE' &&
          elig?.presale_balance?.is_paid_participant &&
          (elig.presale_balance.purchased_available_mints ?? 0) <= 0 ? (
            <div className="space-y-2 border border-[#1A222B] bg-[#0F1419] p-3">
              <p className="text-sm text-[#9BA8B4]">
                No paid presale credits left on this wallet. Link other presale wallets in the Wallets section above, then
                switch to each wallet in your app to mint.
              </p>
            </div>
          ) : null}

          {launch.active_phase === 'PRESALE_OVERAGE' && elig && !elig.is_eligible ? (
            <p className="text-sm text-[#FF9C9C]">
              Presale+13 phase: wallet must be on the 13-spot overage list and still have presale credits. Contact team if
              you bought spot #658–670.
            </p>
          ) : null}

          {launch.active_phase === 'AIRDROP' && elig?.gen1_snapshot?.is_holder ? (
            <p className="text-sm text-[#9BA8B4]">
              GEN1 phase: mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> — one free Gen2 per Gen1 NFT you hold (
              {elig.gen1_snapshot.gen1_nft_count} detected). Sign once per NFT in your wallet.
            </p>
          ) : null}

          {wrongPhaseHint ? <p className="text-sm text-[#9BA8B4]">{wrongPhaseHint}</p> : null}

          {launch.active_phase === 'AIRDROP' && elig?.reason === 'gen1_collection_not_configured' ? (
            <p className="text-sm text-[#FF9C9C]">
              Gen1 verification is not configured on the server (missing collection address). Contact Owl Center support.
            </p>
          ) : null}

          {launch.active_phase === 'AIRDROP' && elig && !elig.is_eligible && elig.reason === 'not_gen1_holder' ? (
            <p className="text-sm text-[#FF9C9C]">
              No Owltopia Gen1 NFT detected on this connected wallet. Use the same wallet that holds your Gen1 on mainnet,
              then refresh eligibility.
            </p>
          ) : null}

          {launch.active_phase === 'AIRDROP' && elig && !elig.is_eligible && elig.reason === 'gen1_mint_limit' ? (
            <p className="text-sm text-[#FF9C9C]">You have already minted your GEN1 allocation for this wallet.</p>
          ) : null}

          {launch.active_phase === 'PRESALE' && elig?.reason === 'gen1_phase_pending' ? (
            <p className="text-sm text-[#9BA8B4]">
              Presale redemption is not open yet — GEN1 mint runs first. Your paid presale spots stay reserved in Allocation
              below until admin opens presale redemption.
            </p>
          ) : null}

          {launch.active_phase === 'PRESALE' &&
          elig?.presale_balance?.is_paid_participant &&
          (elig.presale_balance.purchased_available_mints ?? 0) > 0 &&
          elig.is_eligible ? (
            <p className="text-sm text-[#9BA8B4]">
              Presale redemption: mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> at once from your paid presale credits (
              {elig.presale_balance.purchased_available_mints} left). Sign once per NFT.
            </p>
          ) : null}

          {launch.active_phase === 'WHITELIST' && elig?.wl_allocation && elig.wl_allocation.available_mints > 0 ? (
            <p className="text-sm text-[#9BA8B4]">
              WL phase: mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> at once from your{' '}
              {elig.wl_allocation.available_mints} assigned WL spot
              {elig.wl_allocation.available_mints === 1 ? '' : 's'}. Sign once per NFT.
            </p>
          ) : null}

          {launch.active_phase === 'WHITELIST' && elig && !elig.is_eligible ? (
            <p className="text-sm text-[#FF9C9C]">This wallet is not on the whitelist or has no WL spots left.</p>
          ) : null}

          {!cmConfigured ? (
            <p className="text-xs text-[#FFD769]">Mint infrastructure is not fully configured yet — check back soon.</p>
          ) : null}

          <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
              Quantity
              <input
                type="number"
                min={1}
                max={maxQ}
                value={qty}
                onChange={(e) => setQty(Math.min(maxQ, Math.max(1, Number(e.target.value) || 1)))}
                className="w-24 border border-[#1A222B] bg-[#0F1419] px-3 py-2 font-mono text-sm text-[#F4FBF8] touch-manipulation"
              />
            </label>
            <DeployButton
              disabled={
                mintClosed ||
                !connected ||
                !elig?.is_eligible ||
                step === 'recording_mint' ||
                step === 'sending_transaction' ||
                step === 'awaiting_signature'
              }
              onClick={() => void runMint()}
              className="flex-1 sm:flex-none"
            >
              Mint
            </DeployButton>
          </div>

          <div className="border border-[#1A222B] bg-[#0B0F14] px-3 py-2 font-mono text-[11px] text-[#9BA8B4]">
            <p>
              state=<span className="text-[#00FF9C]">{stepLabel(step)}</span>
            </p>
            {err ? <p className="mt-1 text-[#FF9C9C]">{err}</p> : null}
            {lastSig && step === 'success' ? (
              <a
                href={owlCenterSolanaExplorerTxUrl(lastSig, isDevnetMintEnabled() ? 'devnet' : 'mainnet')}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block min-h-[44px] touch-manipulation text-[#00FF9C] underline"
              >
                View last transaction (Solana Explorer)
              </a>
            ) : null}
          </div>

          <p className="text-xs text-[#5C6773]">
            Phantom / Solflare sign each sequential mint. Server records credits after on-chain success — never trust client-only
            eligibility.
          </p>
        </div>
    </CommandCard>
  )
}

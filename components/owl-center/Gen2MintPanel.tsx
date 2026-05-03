'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { Gen2EligibilityCard } from '@/components/owl-center/Gen2EligibilityCard'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import type { Gen2EligibilityResponse } from '@/lib/owl-center/types'
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
  onRefresh,
}: {
  launch: OwlCenterLaunchPublic
  remaining: number
  onRefresh: () => void
}) {
  const { publicKey, connected, wallet } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const adapter = wallet?.adapter

  const [qty, setQty] = useState(1)
  const [elig, setElig] = useState<Gen2EligibilityResponse | null>(null)
  const [eligLoading, setEligLoading] = useState(false)
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)

  const cmConfigured = Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())

  const loadElig = useCallback(async () => {
    setEligLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/owl-center/gen2/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletStr }),
      })
      const j = (await res.json()) as Gen2EligibilityResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'eligibility_failed')
      setElig(j)
    } catch (e) {
      setElig(null)
      setErr(e instanceof Error ? e.message : 'eligibility_failed')
    } finally {
      setEligLoading(false)
      setStep('idle')
    }
  }, [walletStr])

  useEffect(() => {
    if (!connected || !walletStr) {
      setElig(null)
      return
    }
    void loadElig()
  }, [connected, walletStr, loadElig])

  const maxQ = useMemo(() => {
    if (!elig) return 1
    const phaseCap = elig.active_phase === 'PRESALE' ? elig.max_mintable : Math.min(elig.max_mintable, 10)
    return Math.max(1, Math.min(phaseCap, remaining))
  }, [elig, remaining])

  useEffect(() => {
    setQty((q) => Math.min(Math.max(1, q), maxQ))
  }, [maxQ])

  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || remaining <= 0
  const mintClosed = trading || soldOut || launch.is_paused

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
    const allowedPhases = ['AIRDROP', 'PRESALE', 'WHITELIST', 'PUBLIC'] as const
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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Gen2EligibilityCard eligibility={elig} loading={eligLoading} />

      <CommandCard label="mint_console.sys">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <WalletConnectButton />
            {connected ? (
              <button
                type="button"
                onClick={() => void loadElig()}
                className="font-mono text-[10px] uppercase tracking-widest text-[#00C97A] underline-offset-4 hover:underline touch-manipulation"
              >
                Refresh eligibility
              </button>
            ) : null}
          </div>

          {launch.is_paused ? (
            <p className="border border-[#FFD769]/40 bg-[#FFD769]/10 px-3 py-2 text-sm text-[#FFD769]">
              Mint temporarily paused by Owl Center.
            </p>
          ) : null}

          {launch.active_phase === 'PRESALE' && elig?.presale_balance && elig.presale_balance.available_mints <= 0 ? (
            <div className="space-y-2 border border-[#1A222B] bg-[#0F1419] p-3">
              <p className="text-sm text-[#9BA8B4]">No presale allocation found for this wallet.</p>
              <Link
                href="/gen2-presale"
                className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-4 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
              >
                Buy Presale Spots
              </Link>
            </div>
          ) : null}

          {launch.active_phase === 'WHITELIST' && elig && !elig.is_eligible ? (
            <p className="text-sm text-[#FF9C9C]">This wallet is not on the whitelist.</p>
          ) : null}

          {!cmConfigured ? (
            <p className="font-mono text-xs text-[#FFD769]">
              // TODO: Admin must set Candy Machine ID + collection mint (env or Owl Center admin). WL guard proofs still
              TODO for strict gate.
            </p>
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
    </div>
  )
}

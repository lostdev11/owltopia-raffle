'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MintProgressOverlay } from '@/components/owl-center/MintProgressOverlay'
import { MintQuantityInput, parseMintQuantityText } from '@/components/owl-center/MintQuantityInput'
import { MintSuccessOverlay } from '@/components/owl-center/MintSuccessOverlay'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import {
  owlCenterMintPhaseStatusLabel,
  owlCenterMintWrongPhaseHint,
} from '@/lib/owl-center/phase-display'
import { useGen2MintEligibility } from '@/hooks/use-gen2-mint-eligibility'
import { finalizeMintSessionOptimistic } from '@/lib/owl-center/mint-finalize-client'
import {
  createMintSessionDeadline,
  MINT_SESSION_OUTER_MAX_MS,
  MintSessionTimeoutError,
  raceMintSessionBudget,
} from '@/lib/owl-center/mint-time-budget'
import { isMintInProgress, type MintProgressSnapshot, type MintUiStep } from '@/lib/owl-center/mint-ui-steps'
import { preloadConfetti } from '@/lib/confetti'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { mintGen2FromCandyMachine, warmGen2MintPrep } from '@/lib/solana/gen2-mint'
import {
  getGen2CandyMachineId,
  getGen2CollectionMint,
  isDevnetMintEnabled,
  owlCenterSolanaExplorerTxUrl,
} from '@/lib/solana/network'

export type { MintUiStep } from '@/lib/owl-center/mint-ui-steps'

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

function MintPanelShell({
  embedded,
  label,
  children,
}: {
  embedded?: boolean
  label: string
  children: ReactNode
}) {
  if (embedded) {
    return <div className="mt-6 border-t border-[#1A222B] pt-6">{children}</div>
  }
  return <CommandCard label={label}>{children}</CommandCard>
}

export function Gen2MintPanel({
  launch,
  remaining,
  presaleSoldOut = false,
  mintControls,
  onRefresh,
  embedded = false,
}: {
  launch: OwlCenterLaunchPublic
  remaining: number
  /** True when all presale purchase spots are claimed (distinct from Presale mint redemption phase). */
  presaleSoldOut?: boolean
  mintControls: OwlCenterMintControls
  onRefresh: () => void
  /** When true, render inline inside supply_and_phases (no nested CommandCard). */
  embedded?: boolean
}) {
  const { publicKey, connected, wallet } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const adapter = wallet?.adapter

  const [qtyText, setQtyText] = useState('1')
  const { elig, loading: eligLoading, refresh: loadElig } = useGen2MintEligibility(walletStr, connected)
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)
  const [mintedAddresses, setMintedAddresses] = useState<string[]>([])
  const [mintedCount, setMintedCount] = useState(0)
  const [successWarning, setSuccessWarning] = useState<string | null>(null)
  const [mintProgress, setMintProgress] = useState<MintProgressSnapshot | null>(null)

  const mintNetwork = isDevnetMintEnabled() ? 'devnet' : 'mainnet'

  const dismissSuccess = useCallback(() => {
    setStep('idle')
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
    setSuccessWarning(null)
    setMintProgress(null)
  }, [])

  const cmConfigured = Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())

  const maxQ = useMemo(() => {
    if (!elig) return 1
    return Math.max(1, Math.min(elig.max_mintable, remaining))
  }, [elig, remaining])

  useEffect(() => {
    setQtyText((t) => {
      const n = parseInt(t.trim(), 10)
      if (!Number.isFinite(n) || n < 1) return t
      if (n > maxQ) return String(maxQ)
      return t
    })
  }, [maxQ])

  useEffect(() => {
    if (!connected || !adapter?.publicKey || !elig?.is_eligible || !cmConfigured) return
    const phase = elig.active_phase
    const allowedPhases = ['AIRDROP', 'PRESALE', 'PRESALE_OVERAGE', 'WHITELIST', 'PUBLIC'] as const
    if (!allowedPhases.includes(phase as (typeof allowedPhases)[number])) return
    void warmGen2MintPrep({
      walletAdapter: adapter,
      candyMachineId: getGen2CandyMachineId(launch) ?? '',
      collectionMint: getGen2CollectionMint(launch) ?? '',
      phase,
      launch,
    })
  }, [connected, adapter, elig?.is_eligible, elig?.active_phase, cmConfigured, launch])

  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || remaining <= 0
  const mintClosed = trading || soldOut || mintControls.disabled

  const runMint = async () => {
    setErr(null)
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
    setSuccessWarning(null)
    setMintProgress(null)
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

    const n = Math.min(parseMintQuantityText(qtyText, maxQ), elig.max_mintable, remaining)
    const sessionDeadline = createMintSessionDeadline()
    const outerDeadline = createMintSessionDeadline(MINT_SESSION_OUTER_MAX_MS)
    try {
      setStep('preparing_mint')
      setMintProgress({ current: 0, total: n, phase: 'chain' })
      const minted = await raceMintSessionBudget(
        outerDeadline,
        mintGen2FromCandyMachine({
          walletAdapter: adapter,
          candyMachineId: getGen2CandyMachineId(launch),
          collectionMint: getGen2CollectionMint(launch),
          quantity: n,
          phase,
          launch,
          sessionDeadline,
          onMintProgress: (_current, total) => {
            setStep('awaiting_signature')
            setMintProgress({ current: 0, total, phase: 'chain' })
          },
        }),
        'Mint timed out — check Collectibles in your wallet, then refresh.'
      )

      const sigs = minted.ok ? minted.txSignatures : (minted.txSignatures ?? [])
      const mintPks = minted.ok ? minted.mintedNftMints : (minted.mintedNftMints ?? [])
      if (!minted.ok && mintPks.length === 0 && sigs.length === 0) {
        throw new Error(minted.error || 'mint_failed')
      }

      finalizeMintSessionOptimistic({
        minted,
        requestedQuantity: n,
        confirmBatch: async ({ txSignature, quantity, mintedNftMints }) => {
          const conf = await fetch('/api/owl-center/gen2/confirm-mint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet: walletStr,
              txSignature,
              quantity,
              phase,
              mintedNftMints,
              network: isDevnetMintEnabled() ? 'devnet' : 'mainnet',
            }),
          })
          const cj = (await conf.json()) as { error?: string }
          if (!conf.ok) {
            throw new Error(cj.error || 'Confirm route failed')
          }
        },
        onSuccess: ({ lastSig, mintedAddresses, mintedCount, warning }) => {
          setLastSig(lastSig)
          setMintedAddresses(mintedAddresses)
          setMintedCount(mintedCount)
          setSuccessWarning(warning)
          setMintProgress(null)
          setStep('success')
        },
        onRecordWarning: (message) => {
          setSuccessWarning((prev) => prev ?? message)
        },
      })
      onRefresh()
      void loadElig()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const low = msg.toLowerCase()
      if (e instanceof MintSessionTimeoutError || low.includes('timed out')) {
        setErr('Mint timed out — if you approved in your wallet, check Collectibles. Otherwise tap Mint again.')
      } else if (low.includes('user rejected') || low.includes('cancel')) {
        setErr('Mint transaction rejected in wallet')
      } else if (low.includes('confirm route failed') || low.includes('confirm_failed')) {
        setErr('Transaction succeeded but database record failed — copy your signature from the wallet and contact support.')
      } else if (low.includes('block height') || low.includes('blockhash') || low.includes('expired')) {
        setErr('Transaction expired before it landed — tap Mint again. Any NFTs that already minted are in your wallet.')
      } else {
        setErr(msg)
      }
      setMintProgress(null)
      setStep('error')
    }
  }

  if (trading) {
    return (
      <MintPanelShell embedded={embedded} label="trading.sys">
        <p className="text-sm text-[#9BA8B4]">Trading is now active — secondary markets only.</p>
        <div className="mt-4">
          <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
        </div>
      </MintPanelShell>
    )
  }

  if (soldOut) {
    return (
      <MintPanelShell embedded={embedded} label="sold_out.sys">
        <p className="font-mono text-lg font-bold text-[#FF9C9C]">SOLD OUT</p>
        <p className="mt-2 text-sm text-[#9BA8B4]">Primary mint supply exhausted. Awaiting or viewing trading activation.</p>
        <div className="mt-4">
          <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
        </div>
      </MintPanelShell>
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
    <>
      <MintProgressOverlay open={isMintInProgress(step)} step={step} progress={mintProgress} />
      <MintSuccessOverlay
        open={step === 'success' && Boolean(lastSig || mintedAddresses.length > 0)}
        quantity={mintedCount}
        mintAddresses={mintedAddresses}
        preferMainnet={mintNetwork === 'mainnet'}
        transactionSignature={lastSig ?? ''}
        explorerUrl={lastSig ? owlCenterSolanaExplorerTxUrl(lastSig, mintNetwork) : '#'}
        warning={successWarning}
        onClose={dismissSuccess}
      />
      <MintPanelShell embedded={embedded} label="mint_console">
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
              onClick={() => void loadElig({ background: true })}
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
              {elig.gen1_snapshot.gen1_nft_count} detected). Approve once in your wallet — multiple NFTs mint in one transaction when quantity is above 1.
            </p>
          ) : null}

          {elig?.reason === 'phase_not_started' && elig.phase_starts_at ? (
            <p className="text-sm text-[#FFD769]">
              This phase is scheduled to open {new Date(elig.phase_starts_at).toLocaleString()}. Check the countdown in
              Overview.
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

          {launch.active_phase === 'PRESALE' &&
          elig?.presale_balance?.is_paid_participant &&
          (elig.presale_balance.purchased_available_mints ?? 0) > 0 &&
          elig.is_eligible ? (
            <p className="text-sm text-[#9BA8B4]">
              Presale redemption (free — already paid): mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> at once from your presale credits (
              {elig.presale_balance.purchased_available_mints} left). One wallet approval mints your selected quantity.
            </p>
          ) : null}

          {launch.active_phase === 'WHITELIST' && elig?.wl_allocation && elig.wl_allocation.available_mints > 0 ? (
            <p className="text-sm text-[#9BA8B4]">
              WL phase: mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> at once from your{' '}
              {elig.wl_allocation.available_mints} assigned WL spot
              {elig.wl_allocation.available_mints === 1 ? '' : 's'}. One wallet approval mints your selected quantity.
            </p>
          ) : null}

          {launch.active_phase === 'WHITELIST' && elig && !elig.is_eligible ? (
            <p className="text-sm text-[#FF9C9C]">This wallet is not on the whitelist or has no WL spots left.</p>
          ) : null}

          {!cmConfigured ? (
            <p className="text-xs text-[#FFD769]">Mint infrastructure is not fully configured yet — check back soon.</p>
          ) : null}

          <div className="flex flex-wrap items-end gap-4">
            <MintQuantityInput max={maxQ} value={qtyText} onChange={setQtyText} />
            <DeployButton
              loading={Boolean(connected && eligLoading && !elig)}
              disabled={
                mintClosed ||
                !connected ||
                (eligLoading && !elig) ||
                !elig?.is_eligible ||
                isMintInProgress(step) ||
                !cmConfigured
              }
              onClick={() => {
                preloadConfetti()
                void runMint()
              }}
              className="flex-1 sm:flex-none"
            >
              {isMintInProgress(step)
                ? stepLabel(step)
                : connected && eligLoading && !elig
                  ? 'Checking eligibility…'
                  : 'Mint now'}
            </DeployButton>
          </div>

          <div className="border border-[#1A222B] bg-[#0B0F14] px-3 py-2 font-mono text-[11px] text-[#9BA8B4]">
            <p>
              state=<span className="text-[#00FF9C]">{stepLabel(step)}</span>
            </p>
            {err ? <p className="mt-1 text-[#FF9C9C]">{err}</p> : null}
          </div>

          <p className="text-xs text-[#5C6773]">
            Phantom / Solflare: one approval mints your selected quantity in a single transaction. Server records credits after on-chain success.
          </p>
        </div>
    </MintPanelShell>
    </>
  )
}

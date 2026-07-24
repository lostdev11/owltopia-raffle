'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { Gen2MintWalletNotice } from '@/components/owl-center/Gen2MintWalletNotice'
import { MintProgressOverlay } from '@/components/owl-center/MintProgressOverlay'
import { MintQuantityInput, parseMintQuantityText } from '@/components/owl-center/MintQuantityInput'
import { MintSuccessOverlay } from '@/components/owl-center/MintSuccessOverlay'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import {
  owlCenterMintPhaseStatusLabel,
  owlCenterMintWrongPhaseHint,
  owlCenterPhaseLabel,
} from '@/lib/owl-center/phase-display'
import { useGen2MintEligibility } from '@/hooks/use-gen2-mint-eligibility'
import { finalizeMintSessionOptimistic, isHardMintConfirmFailure } from '@/lib/owl-center/mint-finalize-client'
import {
  attemptOwlCenterMintRecovery,
  isLikelyWalletMintDisconnectError,
} from '@/lib/owl-center/mint-recovery-client'
import { recordMintSessionConfirms, type MintConfirmBatchPayload } from '@/lib/owl-center/mint-session'
import type { RecoveredCandyMachineMint } from '@/lib/solana/recover-candy-machine-mint'
import { reasonLabel } from '@/lib/owl-center/mint-check-reason-label'
import {
  createMintSessionDeadline,
  mintConfirmBackgroundBudgetMs,
  MINT_SESSION_OUTER_MAX_MS,
  MintSessionTimeoutError,
  raceMintSessionBudget,
} from '@/lib/owl-center/mint-time-budget'
import { isMintInProgress, type MintProgressSnapshot, type MintUiStep } from '@/lib/owl-center/mint-ui-steps'
import { preloadConfetti } from '@/lib/confetti'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { Gen2MintCheckPhasePreview, OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'
import { mintGen2FromCandyMachine, warmGen2MintPrep } from '@/lib/solana/gen2-mint'
import { GEN2_TEAM_GUARD_LABEL } from '@/lib/solana/gen2-guards'
import { shouldCollectOwlCenterPlatformMintFeeClient } from '@/lib/solana/owl-center-platform-mint-fee'
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
  publicPoolRemaining,
  presaleSoldOut = false,
  mintControls,
  onRefresh,
  embedded = false,
  mintCheckPhases,
}: {
  launch: OwlCenterLaunchPublic
  remaining: number
  /** Spots left in the WL + public shared pool (987 cap). */
  publicPoolRemaining?: number
  /** True when all presale purchase spots are claimed (distinct from Presale mint redemption phase). */
  presaleSoldOut?: boolean
  mintControls: OwlCenterMintControls
  onRefresh: () => void
  /** When true, render inline inside supply_and_phases (no nested CommandCard). */
  embedded?: boolean
  /** Per-phase previews (from the mint-check). Drives the phase picker when >1 phase is live. */
  mintCheckPhases?: Gen2MintCheckPhasePreview[]
}) {
  const { publicKey, connected, wallet } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const adapter = wallet?.adapter

  // Phases the wallet can mint in RIGHT NOW (live + eligible). When more than one, the user picks.
  const selectablePhases = useMemo(
    () => (mintCheckPhases ?? []).filter((p) => p.is_active && p.is_eligible && p.max_mintable > 0),
    [mintCheckPhases]
  )
  const [selectedPhase, setSelectedPhase] = useState<OwlCenterPhase | null>(null)

  // Default / reconcile the selection: keep the user's pick if still valid, else prefer the primary
  // active phase, else the cheapest eligible live phase.
  useEffect(() => {
    if (selectablePhases.length === 0) {
      if (selectedPhase !== null) setSelectedPhase(null)
      return
    }
    if (selectedPhase && selectablePhases.some((p) => p.phase === selectedPhase)) return
    const primary = selectablePhases.find((p) => p.phase === launch.active_phase)
    const cheapest = [...selectablePhases].sort((a, b) => (a.price_usdc ?? 0) - (b.price_usdc ?? 0))[0]
    setSelectedPhase((primary ?? cheapest).phase)
  }, [selectablePhases, selectedPhase, launch.active_phase])

  const [qtyText, setQtyText] = useState('1')
  const { elig, loading: eligLoading, refresh: loadElig, applyMinted } = useGen2MintEligibility(
    walletStr,
    connected,
    selectedPhase
  )
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)
  const [mintedAddresses, setMintedAddresses] = useState<string[]>([])
  const [mintedCount, setMintedCount] = useState(0)
  const [mintProgress, setMintProgress] = useState<MintProgressSnapshot | null>(null)
  const [recoveringMint, setRecoveringMint] = useState(false)
  // Mint pubkeys planned for the last attempt + the phase it ran in — used to recover a mint that
  // landed on-chain after a mobile wallet (Phantom/Solflare) disconnected before the site finished.
  const lastPlannedMintB58sRef = useRef<string[]>([])
  const lastMintPhaseRef = useRef<OwlCenterPhase | null>(null)
  // True once the wallet has attempted a mint this session — gates the unload reconcile beacon.
  const mintAttemptedRef = useRef(false)

  const mintNetwork = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const candyMachineId = getGen2CandyMachineId(launch)?.trim() ?? ''

  const dismissSuccess = useCallback(() => {
    setStep('idle')
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
    setMintProgress(null)
  }, [])

  const cmConfigured = Boolean(getGen2CandyMachineId(launch)?.trim() && getGen2CollectionMint(launch)?.trim())

  const postGen2Confirm = useCallback(
    async (payload: MintConfirmBatchPayload, phaseForConfirm: OwlCenterPhase) => {
      const conf = await fetch('/api/owl-center/gen2/confirm-mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: walletStr,
          txSignature: payload.txSignature,
          quantity: payload.quantity,
          phase: phaseForConfirm,
          mintedNftMints: payload.mintedNftMints,
          network: mintNetwork,
        }),
        keepalive: true,
      })
      const cj = (await conf.json()) as { error?: string }
      if (!conf.ok) throw new Error(cj.error || 'Confirm route failed')
    },
    [walletStr, mintNetwork]
  )

  const finalizeRecoveredMint = useCallback(
    async (recovered: RecoveredCandyMachineMint) => {
      if (!walletStr || recovered.txSignatures.length === 0) return false
      const sigs = recovered.txSignatures
      const mintPks = recovered.mintedNftMints
      const phaseForConfirm = (lastMintPhaseRef.current ?? elig?.active_phase ?? 'PUBLIC') as OwlCenterPhase

      setStep('recording_mint')
      setMintProgress({ current: 0, total: 1, phase: 'record' })
      try {
        // The scan can surface a bot-tax tx (touched the Candy Machine, minted nothing) — the
        // confirm route proves no NFT and rejects it, which used to throw here with the overlay
        // still on `recording_mint`, hanging forever on "Saving your mint…". Bound the confirm with
        // a budget and always resolve to a terminal step (success or error) below.
        const recordDeadline = createMintSessionDeadline(mintConfirmBackgroundBudgetMs(sigs.length))
        const recorded = await raceMintSessionBudget(
          recordDeadline,
          recordMintSessionConfirms(
            sigs,
            mintPks,
            (payload) => postGen2Confirm(payload, phaseForConfirm),
            () => setMintProgress({ current: 1, total: 1, phase: 'record' })
          ),
          'Saving mint timed out'
        )
        const count = recorded.confirmedCount || mintPks.length || 1
        setLastSig(recorded.lastSig ?? sigs[sigs.length - 1] ?? null)
        setMintedAddresses(mintPks.length ? mintPks : [])
        setMintedCount(count)
        setErr(null)
        setMintProgress(null)
        setStep('success')
        // Debit locally so the Mint button reflects the recovered mint immediately.
        applyMinted(count)
        onRefresh()
        void loadElig({ background: true })
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setMintProgress(null)
        // Hard failure (server verify proved no NFT minted) OR nothing concrete to show: the scan
        // matched a bot-tax / fees-only tx. Clear the overlay and tell the user only fees were
        // charged so they can retry — never leave them stuck on "Saving your mint…".
        if (isHardMintConfirmFailure(msg) || mintPks.length === 0) {
          setMintedAddresses([])
          setMintedCount(0)
          setLastSig(null)
          setErr(
            isHardMintConfirmFailure(msg)
              ? 'That didn’t go through — no NFT was minted (you were only charged the network + platform fee, not the mint price). Your allocation is intact; tap Mint to try again.'
              : 'Couldn’t confirm a mint — check Collectibles in your wallet, then tap Mint to try again if it isn’t there.'
          )
          setStep('error')
          void loadElig()
          return false
        }
        // Soft failure (RPC lag / save timeout) but an NFT WAS detected on-chain — keep the win and
        // let the unload beacon + reconcile cron persist it to the DB.
        setLastSig(sigs[sigs.length - 1] ?? null)
        setMintedAddresses(mintPks)
        setMintedCount(mintPks.length || 1)
        setErr(null)
        setStep('success')
        applyMinted(mintPks.length || 1)
        onRefresh()
        void loadElig({ background: true })
        return true
      }
    },
    [walletStr, elig?.active_phase, postGen2Confirm, applyMinted, onRefresh, loadElig]
  )

  // Scan the chain for a mint that the wallet may have completed before disconnecting. Backs the
  // "My NFT minted — check wallet" button and a silent auto-check after the session budget lapses.
  const checkWalletForMint = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!walletStr || !candyMachineId) return false
      setRecoveringMint(true)
      try {
        const recovered = await attemptOwlCenterMintRecovery({
          walletB58: walletStr,
          candyMachineB58: candyMachineId,
          mintNetwork,
          plannedMintB58s: lastPlannedMintB58sRef.current,
        })
        if (recovered?.txSignatures.length) {
          return finalizeRecoveredMint(recovered)
        }
        if (!options?.silent) {
          setErr('No mint found yet — check Collectibles in your wallet, then tap Mint to try again.')
        }
        return false
      } finally {
        setRecoveringMint(false)
      }
    },
    [walletStr, candyMachineId, mintNetwork, finalizeRecoveredMint]
  )

  useEffect(() => {
    if (!isMintInProgress(step)) return
    const timer = window.setTimeout(() => {
      if (walletStr && candyMachineId) void checkWalletForMint({ silent: true })
    }, MINT_SESSION_OUTER_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [step, walletStr, candyMachineId, checkWalletForMint])

  // Mobile wallets often background/close the page when they return from approval, killing any
  // in-flight confirm. On unload (after a mint was attempted), beacon the server to reconcile this
  // wallet's on-chain mints into the DB so nothing is lost even if the client never finished.
  useEffect(() => {
    if (!walletStr) return
    const fire = () => {
      if (!mintAttemptedRef.current || typeof navigator === 'undefined') return
      try {
        const payload = JSON.stringify({ wallet: walletStr, network: mintNetwork })
        navigator.sendBeacon?.(
          '/api/owl-center/gen2/reconcile-wallet',
          new Blob([payload], { type: 'application/json' })
        )
      } catch {
        // best-effort
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') fire()
    }
    window.addEventListener('pagehide', fire)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', fire)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [walletStr, mintNetwork])

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
  const publicPoolSoldOut =
    launch.active_phase === 'PUBLIC' &&
    publicPoolRemaining != null &&
    publicPoolRemaining <= 0 &&
    remaining > 0
  const mintClosed = trading || soldOut || mintControls.disabled
  const mintButtonLabel = (() => {
    if (isMintInProgress(step)) return stepLabel(step)
    if (connected && eligLoading && !elig) return 'Checking eligibility…'
    if (soldOut) return 'Sold out'
    if (elig?.reason === 'team_backstop') return 'Mint leftovers (team)'
    if (publicPoolSoldOut || elig?.reason === 'public_pool_exhausted') return 'Public sold out'
    if (elig?.reason === 'sold_out' || elig?.reason === 'on_chain_sold_out') return 'Sold out'
    if (elig?.reason === 'allocation_minted') return 'Allocation complete'
    if (!connected) return 'Connect wallet to mint'
    if (!elig?.is_eligible) return 'Not eligible'
    return 'Mint now'
  })()

  const runMint = async () => {
    setErr(null)
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
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
    lastMintPhaseRef.current = phase
    mintAttemptedRef.current = true
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
          ...(elig?.reason === 'team_backstop'
            ? {
                guardGroupOverride: GEN2_TEAM_GUARD_LABEL,
                allowListProofPhase: 'TEAM_BACKSTOP' as const,
              }
            : {}),
          // Attach the ~$1 Owltopia platform fee (SOL) to each mint tx when a treasury is configured.
          collectPlatformMintFee: shouldCollectOwlCenterPlatformMintFeeClient(),
          platformFeeLamports:
            elig?.platform_mint_fee_lamports_estimate != null
              ? BigInt(elig.platform_mint_fee_lamports_estimate)
              : undefined,
          prefetchedWalletBalanceLamports:
            elig?.wallet_sol_balance_lamports != null
              ? BigInt(elig.wallet_sol_balance_lamports)
              : undefined,
          onMintProgress: (_current, total) => {
            setStep('awaiting_signature')
            setMintProgress({ current: 0, total, phase: 'chain' })
          },
        }),
        'Mint timed out — check Collectibles in your wallet, then refresh.'
      )

      if (!minted.ok && minted.plannedMintB58s?.length) {
        lastPlannedMintB58sRef.current = minted.plannedMintB58s
      }

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
            keepalive: true,
          })
          const cj = (await conf.json()) as { error?: string }
          if (!conf.ok) {
            throw new Error(cj.error || 'Confirm route failed')
          }
        },
        onSuccess: ({ lastSig, mintedAddresses, mintedCount }) => {
          setLastSig(lastSig)
          setMintedAddresses(mintedAddresses)
          setMintedCount(mintedCount)
          setMintProgress(null)
          setStep('success')
          // Debit the allocation locally so the Mint button disables immediately — prevents a
          // re-mint during the window before the mint is recorded server-side.
          applyMinted(mintedCount)
        },
        // Reconcile against the server only AFTER the DB record lands; refreshing earlier would
        // read stale (still-eligible) data and undo the optimistic debit above.
        onRecordSuccess: () => {
          onRefresh()
          void loadElig({ background: true })
        },
        // Background confirm failed. Soft failures (RPC lag / save timeout) likely DID land —
        // keep the success overlay and let the unload beacon + reconcile cron settle the DB.
        // A HARD failure means the chain verify proved no NFT was minted (e.g. bot-tax only /
        // failed tx) — the optimistic "You minted N!" overlay is wrong, so downgrade it.
        onRecordWarning: (failure) => {
          if (!failure.hardFailure) {
            onRefresh()
            void loadElig({ background: true })
            return
          }
          void (async () => {
            // Safety net: a *different* tx may have actually landed the mint. Scan the chain and
            // finalize it if found (keeps the success overlay) before alarming the user.
            const recovered = await checkWalletForMint({ silent: true })
            if (recovered) return
            // Truly nothing minted — undo the optimistic overlay + debit and prompt a retry.
            setMintedAddresses([])
            setMintedCount(0)
            setLastSig(null)
            setMintProgress(null)
            setErr(
              'That didn’t go through — no NFT was minted (you may have only paid the network fee). Your allocation is intact; tap Mint to try again.'
            )
            setStep('error')
            // Foreground refresh re-reads server truth, restoring eligibility (undoes the debit).
            void loadElig()
          })()
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const low = msg.toLowerCase()
      // Mobile wallets often land the mint on-chain then disconnect, surfacing as a "simulation
      // failed" / blockhash / timeout error. Silently scan the chain before alarming the user.
      if (
        (e instanceof MintSessionTimeoutError ||
          low.includes('timed out') ||
          isLikelyWalletMintDisconnectError(msg)) &&
        walletStr &&
        candyMachineId
      ) {
        const recovered = await checkWalletForMint({ silent: true })
        if (recovered) return
      }
      if (e instanceof MintSessionTimeoutError || low.includes('timed out')) {
        setErr('That took longer than expected — check Collectibles in your wallet, then tap Mint to try again.')
      } else if (low.includes('user rejected') || low.includes('cancel')) {
        setErr('Mint cancelled in your wallet.')
      } else if (
        low.includes('confirm route failed') ||
        low.includes('confirm_failed') ||
        low.includes('block height') ||
        low.includes('blockhash') ||
        low.includes('expired')
      ) {
        setErr('That didn’t go through — tap Mint to try again.')
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
        <p className="font-mono text-lg font-bold text-[#00FF9C]">Minted out — trade on secondary</p>
        <p className="mt-2 text-sm text-[#9BA8B4]">
          Primary mint is closed. Buy or sell Gen2 on Magic Eden or Tensor.
        </p>
        <div className="mt-4">
          <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
        </div>
      </MintPanelShell>
    )
  }

  if (soldOut) {
    return (
      <MintPanelShell embedded={embedded} label="sold_out.sys">
        <p className="font-mono text-lg font-bold text-[#FF9C9C]">Minted out — trade on secondary</p>
        <p className="mt-2 text-sm text-[#9BA8B4]">
          All {launch.total_supply.toLocaleString()} Gen2 spots have minted. Primary mint is closed — trade on
          secondary markets below.
        </p>
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
    elig && !elig.is_eligible && elig.reason !== 'allocation_minted'
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

          {elig?.reason === 'on_chain_sold_out' ? (
            <p className="border border-[#FF9C9C]/40 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
              {reasonLabel('on_chain_sold_out')}
            </p>
          ) : null}

          {publicPoolSoldOut && elig?.reason !== 'team_backstop' && elig?.reason !== 'on_chain_sold_out' ? (
            <p className="border border-[#FF9C9C]/40 bg-[#FF9C9C]/10 px-3 py-2 text-sm text-[#FF9C9C]">
              {reasonLabel('public_pool_exhausted')}
              {remaining > 0
                ? ` · ${remaining.toLocaleString()} spot${remaining === 1 ? '' : 's'} still reserved for presale & Gen1 backstop.`
                : null}
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

          {elig?.active_phase === 'AIRDROP' && elig?.gen1_snapshot?.is_holder ? (
            <p className="text-sm text-[#9BA8B4]">
              GEN1 phase: mint up to{' '}
              <span className="font-mono text-[#00FF9C]">{elig.max_mintable}</span> — one free Gen2 per Gen1 in the
              airdrop snapshot ({elig.gen1_snapshot.gen1_nft_count} reserved). Approve once in your wallet to mint your
              selected quantity.
            </p>
          ) : null}

          {elig?.reason === 'allocation_minted' ? (
            <p className="text-sm text-[#00FF9C]">
              You’ve minted your full allocation for this phase. You can mint again when the next phase you’re eligible
              for opens.
            </p>
          ) : null}

          {elig?.reason === 'phase_not_started' && elig.phase_starts_at ? (
            <p className="text-sm text-[#FFD769]">
              This phase is scheduled to open {new Date(elig.phase_starts_at).toLocaleString()}. Check the countdown in
              Overview.
            </p>
          ) : null}

          {wrongPhaseHint ? <p className="text-sm text-[#9BA8B4]">{wrongPhaseHint}</p> : null}

          {elig?.active_phase === 'AIRDROP' && elig?.reason === 'gen1_collection_not_configured' ? (
            <p className="text-sm text-[#FF9C9C]">
              Gen1 verification is not configured on the server (missing collection address). Contact Owl Center support.
            </p>
          ) : null}

          {elig?.active_phase === 'AIRDROP' && elig && !elig.is_eligible && elig.reason === 'not_gen1_holder' ? (
            <p className="text-sm text-[#FF9C9C]">
              This wallet is not on the Gen1 airdrop snapshot. Gen1s bought after the snapshot do not unlock free Gen2
              mints — connect a snapshotted wallet, then refresh eligibility.
            </p>
          ) : null}

          {elig?.active_phase === 'AIRDROP' && elig && !elig.is_eligible && elig.reason === 'gen1_mint_limit' ? (
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

          {selectablePhases.length > 1 ? (
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
                Choose mint phase — {selectablePhases.length} are live for you right now
              </p>
              <div className="flex flex-wrap gap-2">
                {selectablePhases.map((p) => {
                  const active = p.phase === selectedPhase
                  return (
                    <button
                      key={p.phase}
                      type="button"
                      onClick={() => setSelectedPhase(p.phase)}
                      aria-pressed={active}
                      className={`inline-flex min-h-[44px] touch-manipulation flex-col items-start justify-center gap-0.5 border px-3 py-1.5 text-left transition-colors ${
                        active
                          ? 'border-[#00FF9C]/60 bg-[#00FF9C]/10 text-[#00FF9C]'
                          : 'border-[#1A222B] bg-[#0F1419] text-[#9BA8B4] hover:border-[#00FF9C]/35'
                      }`}
                    >
                      <span className="font-mono text-xs font-bold uppercase tracking-widest">
                        {owlCenterPhaseLabel(p.phase)}
                      </span>
                      <span className="font-mono text-[10px] tracking-wide">
                        {p.price_usdc && p.price_usdc > 0 ? `$${p.price_usdc} + fees` : 'Free + fees'} · up to {p.max_mintable}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <Gen2MintWalletNotice className="mb-1" />

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
              {mintButtonLabel}
            </DeployButton>
          </div>

          {err ? (
            <div className="border border-[#FF9C9C]/30 bg-[#FF9C9C]/5 px-3 py-2 text-sm text-[#FF9C9C]">
              {err}
            </div>
          ) : null}

          {step === 'error' && connected && cmConfigured ? (
            <DeployButton
              variant="ghost"
              className="w-full sm:w-auto"
              loading={recoveringMint}
              disabled={recoveringMint || isMintInProgress(step)}
              onClick={() => void checkWalletForMint()}
            >
              My NFT minted — check wallet
            </DeployButton>
          ) : null}

          <p className="text-xs text-[#5C6773]">
            Phantom / Solflare: approve once to mint your selected quantity. Mint price is shown in
            USD — your wallet also needs SOL for fees (≈$1 platform fee + network + NFT rent).
          </p>
        </div>
    </MintPanelShell>
    </>
  )
}

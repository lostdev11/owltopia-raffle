'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { DeployButton } from '@/components/owl-center/DeployButton'
import { MintProgressOverlay } from '@/components/owl-center/MintProgressOverlay'
import { MintQuantityInput, parseMintQuantityText } from '@/components/owl-center/MintQuantityInput'
import { MintSuccessOverlay } from '@/components/owl-center/MintSuccessOverlay'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import { useCollectionMintEligibility } from '@/hooks/use-collection-mint-eligibility'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { postCollectionConfirmMintWithRetry } from '@/lib/owl-center/confirm-mint-client'
import { finalizeMintSessionOptimistic } from '@/lib/owl-center/mint-finalize-client'
import { recordMintSessionConfirms } from '@/lib/owl-center/mint-session'
import {
  createMintSessionDeadline,
  MINT_SESSION_OUTER_MAX_MS,
  MintSessionTimeoutError,
  raceMintSessionBudget,
} from '@/lib/owl-center/mint-time-budget'
import { isMintInProgress, type MintProgressSnapshot, type MintUiStep } from '@/lib/owl-center/mint-ui-steps'
import { collectionMintDisabledHint } from '@/lib/owl-center/mint-button-hint'
import { formatOwlCenterPlatformMintFeeSolLabel } from '@/lib/owl-center/platform-mint-fee'
import { shouldCollectOwlCenterPlatformMintFeeClient } from '@/lib/solana/owl-center-platform-mint-fee'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  getLaunchCandyMachineId,
  getLaunchCollectionMint,
  resolveLaunchMintNetwork,
} from '@/lib/solana/launch-cm'
import { attemptOwlCenterMintRecovery, isLikelyWalletMintDisconnectError } from '@/lib/owl-center/mint-recovery-client'
import { mintGen2FromCandyMachine, warmGen2MintPrep } from '@/lib/solana/gen2-mint'
import type { RecoveredCandyMachineMint } from '@/lib/solana/recover-candy-machine-mint'
import { preloadConfetti } from '@/lib/confetti'
import { owlCenterSolanaExplorerTxUrl } from '@/lib/solana/network'

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

  const [qtyText, setQtyText] = useState('1')
  const { elig, loading: eligLoading, error: eligError, refresh: loadElig } = useCollectionMintEligibility(slug, walletStr, connected)
  const [step, setStep] = useState<MintUiStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [lastSig, setLastSig] = useState<string | null>(null)
  const [mintedAddresses, setMintedAddresses] = useState<string[]>([])
  const [mintedCount, setMintedCount] = useState(0)
  const [mintProgress, setMintProgress] = useState<MintProgressSnapshot | null>(null)
  const [recoveringMint, setRecoveringMint] = useState(false)
  const lastPlannedMintB58sRef = useRef<string[]>([])

  const candyMachineId = getLaunchCandyMachineId(launch, mintNetwork)?.trim() ?? ''
  const cmConfigured = Boolean(candyMachineId && getLaunchCollectionMint(launch, mintNetwork)?.trim())

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
    void warmGen2MintPrep({
      walletAdapter: adapter,
      candyMachineId,
      collectionMint: getLaunchCollectionMint(launch, mintNetwork)?.trim() ?? '',
      phase: 'PUBLIC',
      launch,
      mintNetwork,
    })
  }, [connected, adapter, elig?.is_eligible, cmConfigured, candyMachineId, launch, mintNetwork])

  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || remaining <= 0
  const mintClosed = trading || soldOut || mintControls.disabled

  const dismissSuccess = useCallback(() => {
    setStep('idle')
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
    setMintProgress(null)
  }, [])

  const finalizeRecoveredMint = useCallback(
    async (recovered: RecoveredCandyMachineMint) => {
      if (!walletStr || recovered.txSignatures.length === 0) return false

      const sigs = recovered.txSignatures
      const mintPks = recovered.mintedNftMints
      let confirmedCount = 0
      let confirmedLastSig: string | null = null
      let confirmedMintAddresses: string[] = []

      setStep('recording_mint')
      setMintProgress({ current: 0, total: 1, phase: 'record' })
      const recorded = await recordMintSessionConfirms(
        sigs,
        mintPks,
        async ({ txSignature, quantity, mintedNftMints }) => {
          await postCollectionConfirmMintWithRetry(slug, {
            wallet: walletStr,
            txSignature,
            quantity,
            phase: 'PUBLIC',
            mintedNftMints,
            network: mintNetwork,
          })
        },
        () => {
          confirmedCount = Math.max(mintPks.length, 1)
          setMintedCount(Math.max(mintPks.length, 1))
          setMintProgress({ current: 1, total: 1, phase: 'record' })
        }
      )
      confirmedLastSig = recorded.lastSig

      setLastSig(confirmedLastSig ?? sigs[sigs.length - 1] ?? null)
      setMintedAddresses(mintPks.length ? mintPks : [])
      setMintedCount(confirmedCount || mintPks.length || 1)
      setErr(null)
      setMintProgress(null)
      setStep('success')
      await Promise.all([loadElig(), onRefresh()])
      return true
    },
    [walletStr, slug, mintNetwork, loadElig, onRefresh]
  )

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
      if (walletStr && candyMachineId) {
        void checkWalletForMint({ silent: true })
      }
    }, MINT_SESSION_OUTER_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [step, walletStr, candyMachineId, checkWalletForMint])

  const runMint = async () => {
    setErr(null)
    setLastSig(null)
    setMintedAddresses([])
    setMintedCount(0)
    setMintProgress(null)
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
          candyMachineId: getLaunchCandyMachineId(launch, mintNetwork),
          collectionMint: getLaunchCollectionMint(launch, mintNetwork),
          quantity: n,
          phase: 'PUBLIC',
          launch,
          mintNetwork,
          sessionDeadline,
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
          await postCollectionConfirmMintWithRetry(slug, {
            wallet: walletStr,
            txSignature,
            quantity,
            phase: 'PUBLIC',
            mintedNftMints,
            network: mintNetwork,
          })
        },
        onSuccess: ({ lastSig, mintedAddresses, mintedCount }) => {
          setLastSig(lastSig)
          setMintedAddresses(mintedAddresses)
          setMintedCount(mintedCount)
          setMintProgress(null)
          setStep('success')
        },
      })
      void Promise.all([loadElig(), onRefresh()])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'mint_failed'
      const low = msg.toLowerCase()
      if (e instanceof MintSessionTimeoutError || low.includes('timed out')) {
        const recovered = await checkWalletForMint({ silent: true })
        if (recovered) return
      }
      if (isLikelyWalletMintDisconnectError(msg) && walletStr && candyMachineId) {
        const recovered = await checkWalletForMint({ silent: true })
        if (recovered) return
      }
      setErr(
        low.includes('user rejected') || low.includes('cancel')
          ? 'Mint cancelled in your wallet.'
          : low.includes('platform mint fee') ||
              low.includes('confirm_failed') ||
              low.includes('database record failed') ||
              low.includes('block height') ||
              low.includes('blockhash') ||
              low.includes('expired')
            ? 'That didn’t go through — tap Mint to try again.'
            : msg
      )
      setMintProgress(null)
      setStep('error')
    }
  }

  const priceLabel = formatPhasePriceSolOrFree(elig?.unit_lamports_estimate ?? null, {
    paid: launch.public_price_usdc != null && launch.public_price_usdc > 0,
  })
  const platformFeeLabel =
    elig?.platform_mint_fee_label ??
    formatOwlCenterPlatformMintFeeSolLabel(
      elig?.platform_mint_fee_lamports_estimate != null
        ? BigInt(elig.platform_mint_fee_lamports_estimate)
        : null
    )

  const mintDisabledHint = collectionMintDisabledHint({
    connected,
    eligLoading,
    elig,
    eligError,
    cmConfigured,
  })

  const mintButtonDisabled =
    !connected ||
    (eligLoading && !elig) ||
    !elig?.is_eligible ||
    isMintInProgress(step) ||
    !cmConfigured

  if (trading) {
    return (
      <CommandCard label="TRADE // marketplaces">
        <TradingButtons magicEdenUrl={launch.magic_eden_url} tensorUrl={launch.tensor_url} />
      </CommandCard>
    )
  }

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
      <CommandCard label={`MINT // public · ${mintNetwork}`}>
      <div className="space-y-4">
        <p className="break-words font-mono text-xs leading-relaxed text-[#9BA8B4]">
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
            ) : eligError ? (
              <p className="text-sm text-[#FFD769]">Could not verify eligibility — check your connection and tap Refresh.</p>
            ) : eligLoading && !elig ? (
              <p className="font-mono text-xs text-[#00FF9C]">Checking eligibility…</p>
            ) : (
              <p className="text-sm text-[#C5D0D8]">{elig?.reason ?? (elig?.is_eligible ? 'Eligible to mint' : '—')}</p>
            )}

            {connected && elig?.is_eligible && maxQ > 1 ? (
              <MintQuantityInput max={maxQ} value={qtyText} onChange={setQtyText} />
            ) : null}

            <DeployButton
              className="w-full sm:w-auto"
              loading={Boolean(connected && eligLoading && !elig)}
              disabled={mintButtonDisabled}
              onClick={() => {
                preloadConfetti()
                if (connected && adapter?.publicKey && elig?.is_eligible && cmConfigured) {
                  void warmGen2MintPrep({
                    walletAdapter: adapter,
                    candyMachineId,
                    collectionMint: getLaunchCollectionMint(launch, mintNetwork)?.trim() ?? '',
                    phase: 'PUBLIC',
                    launch,
                    mintNetwork,
                  })
                }
                void runMint()
              }}
            >
              {isMintInProgress(step)
                ? stepLabel(step)
                : connected && eligLoading && !elig
                  ? 'Checking eligibility…'
                  : 'Mint now'}
            </DeployButton>

            {mintDisabledHint ? (
              <p
                className={`text-sm leading-relaxed ${mintButtonDisabled || eligError ? 'text-[#FFD769]' : 'text-[#9BA8B4]'}`}
              >
                {mintDisabledHint}
              </p>
            ) : null}

            {connected && (eligError || (!eligLoading && !elig?.is_eligible && elig)) ? (
              <button
                type="button"
                onClick={() => void loadElig({ background: true })}
                className="min-h-[44px] touch-manipulation font-mono text-[10px] uppercase tracking-widest text-[#00C97A] underline-offset-4 hover:underline"
              >
                Refresh eligibility
              </button>
            ) : null}
          </>
        )}

        {err ? <p className="text-sm text-red-400">{err}</p> : null}
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
      </div>
    </CommandCard>
    </>
  )
}

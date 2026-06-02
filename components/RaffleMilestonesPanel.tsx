'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Entry, Raffle, RaffleMilestone } from '@/lib/types'
import {
  buildMilestoneBonusRulesCopy,
  buildSingleMilestoneRuleLine,
  MILESTONE_BETA_NOTICE,
  formatMilestonePrize,
  milestoneWinnerModeLabel,
} from '@/lib/raffles/milestones/copy'
import {
  aggregateWalletTickets,
  milestoneTargetTickets,
  ticketsSoldFromEntries,
} from '@/lib/raffles/milestones/draw'
import { getEffectiveDrawThresholdTickets } from '@/lib/raffles/nft-raffle-economics'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { fetchFundsEscrowAddress } from '@/lib/client/create-raffle-milestone-deposit'
import { getTokenInfo } from '@/lib/tokens'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

function shortWallet(w: string): string {
  const t = w.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

type Props = {
  raffle: Raffle
  milestones: RaffleMilestone[]
  entries: Entry[]
  sessionWallet: string | null
  onRefresh?: () => void
}

export function RaffleMilestonesPanel({
  raffle,
  milestones,
  entries,
  sessionWallet,
  onRefresh,
}: Props) {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [depositTxByMilestone, setDepositTxByMilestone] = useState<Record<string, string>>({})
  const [fundsEscrowAddress, setFundsEscrowAddress] = useState<string | null>(() =>
    (raffle.funds_escrow_address_snapshot ?? '').trim() || null
  )
  const [escrowCopied, setEscrowCopied] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(true)

  const sold = useMemo(() => ticketsSoldFromEntries(entries), [entries])
  const drawThresholdTickets = useMemo(
    () => getEffectiveDrawThresholdTickets(raffle),
    [raffle]
  )
  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  const isCreator =
    !!sessionWallet && !!creatorWallet && walletsEqualSolana(sessionWallet, creatorWallet)

  const leaderboard = useMemo(() => {
    const rows = aggregateWalletTickets(entries)
    return rows.sort((a, b) => b.tickets - a.tickets).slice(0, 5)
  }, [entries])

  const rules = buildMilestoneBonusRulesCopy()

  const needsMilestoneDeposit = useMemo(
    () =>
      isCreator &&
      milestones.some((m) => m.prize_type === 'crypto' && !m.deposit_verified_at),
    [isCreator, milestones]
  )

  useEffect(() => {
    if (fundsEscrowAddress) return
    let cancelled = false
    void fetchFundsEscrowAddress().then((addr) => {
      if (!cancelled && addr) setFundsEscrowAddress(addr)
    })
    return () => {
      cancelled = true
    }
  }, [fundsEscrowAddress])

  useEffect(() => {
    if (needsMilestoneDeposit) setPanelCollapsed(false)
  }, [needsMilestoneDeposit])

  const copyFundsEscrowAddress = useCallback(async () => {
    if (!fundsEscrowAddress) return
    try {
      await navigator.clipboard.writeText(fundsEscrowAddress)
      setEscrowCopied(true)
      window.setTimeout(() => setEscrowCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [fundsEscrowAddress])

  const depositMilestone = useCallback(
    async (m: RaffleMilestone) => {
      if (!publicKey || !connected || m.prize_type !== 'crypto' || !m.prize_currency) return
      setActionError(null)
      setLoadingId(`deposit-${m.id}`)
      try {
        const escrow = getFundsEscrowPublicKey()
        if (!escrow) {
          setActionError('Funds escrow is not configured.')
          return
        }
        const amount = Number(m.prize_amount ?? 0)
        const currency = m.prize_currency
        const escrowPk = new PublicKey(escrow)
        let sig: string

        if (currency === 'SOL') {
          const lamports = Math.round(amount * 1e9)
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: escrowPk,
              lamports,
            })
          )
          sig = await sendTransaction(tx, connection)
          await confirmSignatureSuccessOnChain(connection, sig)
        } else {
          const tokenInfo = getTokenInfo('USDC')
          if (!tokenInfo.mintAddress) {
            setActionError('USDC is not configured.')
            return
          }
          const mint = new PublicKey(tokenInfo.mintAddress)
          const decimals = tokenInfo.decimals
          const raw = BigInt(Math.round(amount * Math.pow(10, decimals)))
          const fromAta = await getAssociatedTokenAddress(
            mint,
            publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
          const toAta = await getAssociatedTokenAddress(
            mint,
            escrowPk,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
          const tx = new Transaction()
          try {
            await getAccount(connection, toAta, 'confirmed', TOKEN_PROGRAM_ID)
          } catch {
            tx.add(
              createAssociatedTokenAccountInstruction(
                publicKey,
                toAta,
                escrowPk,
                mint,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID
              )
            )
          }
          tx.add(
            createTransferInstruction(fromAta, toAta, publicKey, raw, [], TOKEN_PROGRAM_ID)
          )
          sig = await sendTransaction(tx, connection)
          await confirmSignatureSuccessOnChain(connection, sig)
        }

        const res = await fetch(`/api/raffles/${raffle.id}/milestones/verify-deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ milestone_id: m.id, deposit_tx: sig }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof json.error === 'string' ? json.error : 'Deposit verification failed')
          return
        }
        onRefresh?.()
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Deposit failed')
      } finally {
        setLoadingId(null)
      }
    },
    [publicKey, connected, connection, sendTransaction, raffle.id, onRefresh]
  )

  const verifyManualTx = useCallback(
    async (m: RaffleMilestone) => {
      const tx = (depositTxByMilestone[m.id] || '').trim()
      if (!tx) {
        setActionError('Paste the deposit transaction signature first.')
        return
      }
      setActionError(null)
      setLoadingId(`verify-${m.id}`)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/milestones/verify-deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ milestone_id: m.id, deposit_tx: tx }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof json.error === 'string' ? json.error : 'Verification failed')
          return
        }
        onRefresh?.()
      } finally {
        setLoadingId(null)
      }
    },
    [depositTxByMilestone, raffle.id, onRefresh]
  )

  const runDraw = useCallback(
    async (m: RaffleMilestone) => {
      setActionError(null)
      setLoadingId(`draw-${m.id}`)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/milestones/${m.id}/run-draw`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof json.error === 'string' ? json.error : 'Draw failed')
          return
        }
        onRefresh?.()
      } finally {
        setLoadingId(null)
      }
    },
    [raffle.id, onRefresh]
  )

  const claimPrize = useCallback(
    async (m: RaffleMilestone) => {
      setActionError(null)
      setLoadingId(`claim-${m.id}`)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/milestones/${m.id}/claim`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof json.error === 'string' ? json.error : 'Claim failed')
          return
        }
        onRefresh?.()
      } finally {
        setLoadingId(null)
      }
    },
    [raffle.id, onRefresh]
  )

  const claimReturn = useCallback(
    async (m: RaffleMilestone) => {
      setActionError(null)
      setLoadingId(`return-${m.id}`)
      try {
        const res = await fetch(`/api/raffles/${raffle.id}/claim-milestone-return`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ milestone_id: m.id }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof json.error === 'string' ? json.error : 'Return failed')
          return
        }
        onRefresh?.()
      } finally {
        setLoadingId(null)
      }
    },
    [raffle.id, onRefresh]
  )

  if (milestones.length === 0) return null

  const showLeaderboard = milestones.some((m) => m.winner_mode === 'top_buyer')

  const milestoneProgressBlocks = milestones.map((m) => {
    const target = milestoneTargetTickets(raffle, m)
    const progress = Math.min(100, target > 0 ? Math.round((sold / target) * 100) : 0)
    const unlocked = m.status !== 'pending'
    return { m, target, progress, unlocked }
  })

  return (
    <section
      id="bonus-milestones"
      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 space-y-3 scroll-mt-24"
    >
      <button
        type="button"
        className="flex w-full min-h-[44px] items-center justify-between gap-3 text-left touch-manipulation rounded-md -mx-1 px-1"
        style={{ touchAction: 'manipulation' }}
        aria-expanded={!panelCollapsed}
        aria-controls="bonus-milestones-panel-body"
        onClick={() => setPanelCollapsed((c) => !c)}
      >
        <span className="text-lg font-semibold text-foreground">Bonus milestones</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
            panelCollapsed ? '' : 'rotate-180'
          }`}
          aria-hidden
        />
      </button>

      <div className="space-y-3">
        {milestoneProgressBlocks.map(({ m, target, progress, unlocked }) => (
          <div key={m.id} className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {sold} / {target} tickets
              </span>
              <span>{unlocked ? 'Unlocked' : `${progress}%`}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {!panelCollapsed ? (
        <div id="bonus-milestones-panel-body" className="space-y-4 pt-1">
      <p className="text-sm text-muted-foreground">
        Extra prizes prefunded in funds escrow — separate from the main prize.
      </p>

      <details className="group rounded-md border border-border/60 bg-background/30">
        <summary
          className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-foreground touch-manipulation [&::-webkit-details-marker]:hidden"
          style={{ touchAction: 'manipulation' }}
        >
          <span>How bonus milestones work</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-2">
          <p className="text-xs text-amber-200/90">{MILESTONE_BETA_NOTICE}</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {rules.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </details>

      {needsMilestoneDeposit && fundsEscrowAddress ? (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2">
          <p className="text-xs text-muted-foreground">Funds escrow wallet (for manual bonus transfers)</p>
          <p className="font-mono text-xs sm:text-sm text-foreground break-all leading-relaxed">
            {fundsEscrowAddress}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation w-full sm:w-auto"
            style={{ touchAction: 'manipulation' }}
            onClick={() => void copyFundsEscrowAddress()}
          >
            <Copy className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            {escrowCopied ? 'Copied' : 'Copy escrow wallet'}
          </Button>
        </div>
      ) : null}

      {milestoneProgressBlocks.map(({ m, unlocked }) => {
        const ruleLine = buildSingleMilestoneRuleLine(m, raffle.max_tickets, drawThresholdTickets)

        return (
          <div key={m.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-3">
            <p className="text-sm font-medium">{ruleLine}</p>
            <p className="text-xs text-muted-foreground">
              {formatMilestonePrize(m)} · {milestoneWinnerModeLabel(m.winner_mode)}
            </p>

            {!unlocked && (
              <p className="text-xs text-muted-foreground">
                Pays only if the raffle hits its draw threshold.
              </p>
            )}

            {isCreator && !m.deposit_verified_at && m.prize_type === 'crypto' && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-amber-200/90">
                  Deposit {formatMilestonePrize(m)} to funds escrow before tickets go live.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-[44px] touch-manipulation w-full sm:w-auto"
                  disabled={!connected || loadingId === `deposit-${m.id}`}
                  onClick={() => depositMilestone(m)}
                >
                  {loadingId === `deposit-${m.id}` ? 'Depositing…' : 'Deposit bonus to escrow'}
                </Button>
                <div className="space-y-1">
                  <Label htmlFor={`milestone-tx-${m.id}`} className="text-xs">
                    Or paste deposit tx
                  </Label>
                  <Input
                    id={`milestone-tx-${m.id}`}
                    value={depositTxByMilestone[m.id] ?? ''}
                    onChange={(e) =>
                      setDepositTxByMilestone((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    className="min-h-[44px] text-base sm:text-sm"
                    placeholder="Transaction signature"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] touch-manipulation"
                    disabled={loadingId === `verify-${m.id}`}
                    onClick={() => verifyManualTx(m)}
                  >
                    Verify deposit
                  </Button>
                </div>
              </div>
            )}

            {isCreator &&
              m.winner_mode === 'creator_initiated_pull' &&
              m.status === 'unlocked' &&
              !m.winner_wallet &&
              new Date(raffle.end_time) > new Date() && (
                <Button
                  type="button"
                  size="sm"
                  className="min-h-[44px] touch-manipulation w-full sm:w-auto"
                  disabled={loadingId === `draw-${m.id}`}
                  onClick={() => runDraw(m)}
                >
                  {loadingId === `draw-${m.id}` ? 'Drawing…' : 'Run random milestone draw'}
                </Button>
              )}

            {m.winner_wallet && (
              <p className="text-sm">
                Bonus winner: <span className="font-mono">{shortWallet(m.winner_wallet)}</span>
              </p>
            )}

            {sessionWallet &&
              m.winner_wallet &&
              walletsEqualSolana(m.winner_wallet, sessionWallet) &&
              m.status === 'awarded' &&
              m.prize_type === 'crypto' && (
                <Button
                  type="button"
                  size="sm"
                  className="min-h-[44px] touch-manipulation"
                  disabled={loadingId === `claim-${m.id}`}
                  onClick={() => claimPrize(m)}
                >
                  {loadingId === `claim-${m.id}` ? 'Claiming…' : 'Claim bonus prize'}
                </Button>
              )}

            {isCreator &&
              (raffle.status === 'failed_refund_available' || raffle.status === 'cancelled') &&
              m.deposit_verified_at &&
              m.status === 'void' &&
              !m.returned_at && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] touch-manipulation"
                  disabled={loadingId === `return-${m.id}`}
                  onClick={() => claimReturn(m)}
                >
                  {loadingId === `return-${m.id}` ? 'Returning…' : 'Claim milestone deposit back'}
                </Button>
              )}
          </div>
        )
      })}

      {showLeaderboard && leaderboard.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Top buyers (bonus leaderboard)</h3>
          <ol className="text-sm space-y-1">
            {leaderboard.map((row, i) => (
              <li key={row.wallet} className="flex justify-between gap-2 font-mono text-xs sm:text-sm">
                <span>
                  #{i + 1} {shortWallet(row.wallet)}
                </span>
                <span className="text-muted-foreground">{row.tickets} tickets</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}
        </div>
      ) : null}
    </section>
  )
}

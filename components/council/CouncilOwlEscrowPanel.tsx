'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowDown, Landmark, Loader2 } from 'lucide-react'
import { owlRawToDecimalString, owlUiToRawBigint } from '@/lib/council/owl-amount-format'
import { OWL_TICKER } from '@/lib/council/owl-ticker'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'

const HEADER = 'X-Connected-Wallet'

/** GET /api/council/escrow returns `reason` when enabled is false */
const ESCROW_DISABLED_COPY: Record<string, string> = {
  owl_not_configured: `${OWL_TICKER} is not enabled for this deployment (mint address missing).`,
  escrow_not_configured: 'Council receiving wallet is not configured on the server.',
  owl_mint_missing: `${OWL_TICKER} mint metadata is missing on the server.`,
}

type EscrowConfig = {
  enabled: true
  escrowAddress: string
  owlMint: string
  decimals: number
  minDepositUi: number
}

export type CouncilOwlEscrowPanelProps = {
  /** When set and matches connected wallet, balance API is called with session cookies. */
  sessionWallet: string | null
}

type VoteLockBreakdownRow = {
  proposalId: string
  slug: string
  title: string
  lockedDecimal: string
}

function parseVoteLockBreakdown(raw: unknown): VoteLockBreakdownRow[] {
  if (!Array.isArray(raw)) return []
  const out: VoteLockBreakdownRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const proposalId = typeof o.proposalId === 'string' ? o.proposalId.trim() : ''
    const slug = typeof o.slug === 'string' ? o.slug.trim() : ''
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const lockedDecimal = typeof o.lockedDecimal === 'string' ? o.lockedDecimal.trim() : ''
    if (!proposalId || !slug || !lockedDecimal) continue
    out.push({ proposalId, slug, title: title || 'Proposal', lockedDecimal })
  }
  return out
}

/**
 * Deposit OWL into council escrow (on-chain) and withdraw back to wallet after votes.
 * Requires `COUNCIL_OWL_ESCROW_SECRET_KEY` on the server + migration 075.
 */
export function CouncilOwlEscrowPanel({ sessionWallet }: CouncilOwlEscrowPanelProps) {
  const { connection } = useConnection()
  const { publicKey, connected, sendTransaction, signMessage } = useWallet()
  const { signIn: siwsSignIn, signingIn: siwsSigningIn, error: siwsError } = useSiwsSignIn()
  const wallet = publicKey?.toBase58() ?? ''

  const [config, setConfig] = useState<EscrowConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [balanceDecimal, setBalanceDecimal] = useState<string | null>(null)
  const [withdrawableDecimal, setWithdrawableDecimal] = useState<string | null>(null)
  const [voteLockedDecimal, setVoteLockedDecimal] = useState<string | null>(null)
  /** From API — use for strict >0 check (avoids parsing decimal strings). */
  const [voteLockedRaw, setVoteLockedRaw] = useState<string | null>(null)
  const [voteLockBreakdown, setVoteLockBreakdown] = useState<VoteLockBreakdownRow[]>([])
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [depositUi, setDepositUi] = useState('')
  const [withdrawUi, setWithdrawUi] = useState('')
  const [busy, setBusy] = useState<'dep' | 'depAll' | 'wd' | 'wdAll' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [configFetchFailed, setConfigFetchFailed] = useState(false)
  /** Set when HTTP 200 but `enabled: false` — avoids silent empty panel when API disagrees with RSC shell */
  const [escrowUnavailableReason, setEscrowUnavailableReason] = useState<string | null>(null)

  const loadEscrowConfig = useCallback(async () => {
    setConfigFetchFailed(false)
    setEscrowUnavailableReason(null)
    setConfigLoading(true)
    try {
      const r = await fetch('/api/council/escrow', { cache: 'no-store' })
      let data: {
        enabled?: boolean
        escrowAddress?: string
        owlMint?: string
        decimals?: number
        minDepositUi?: number
      } = {}
      try {
        data = await r.json()
      } catch {
        data = {}
      }
      if (!r.ok) {
        setConfig(null)
        setConfigFetchFailed(true)
        return
      }
      if (
        data.enabled === true &&
        data.escrowAddress &&
        data.owlMint &&
        typeof data.decimals === 'number'
      ) {
        setEscrowUnavailableReason(null)
        setConfig({
          enabled: true,
          escrowAddress: data.escrowAddress,
          owlMint: data.owlMint,
          decimals: data.decimals,
          minDepositUi: typeof data.minDepositUi === 'number' ? data.minDepositUi : 1,
        })
      } else {
        setConfig(null)
        const reason = typeof (data as { reason?: string }).reason === 'string' ? (data as { reason: string }).reason : ''
        setEscrowUnavailableReason(reason || 'disabled')
      }
    } catch {
      setConfig(null)
      setConfigFetchFailed(true)
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadEscrowConfig()
  }, [loadEscrowConfig])

  const sessionMatches = Boolean(sessionWallet && wallet && sessionWallet === wallet)

  const refreshBalance = useCallback(async () => {
    if (!config || !wallet || !sessionMatches) {
      setBalanceDecimal(null)
      setWithdrawableDecimal(null)
      setVoteLockedDecimal(null)
      setVoteLockedRaw(null)
      setVoteLockBreakdown([])
      return
    }
    setBalanceLoading(true)
    try {
      const res = await fetch('/api/council/escrow/balance', {
        credentials: 'include',
        headers: { [HEADER]: wallet },
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && typeof (data as { balanceDecimal?: string }).balanceDecimal === 'string') {
        const d = data as {
          balanceDecimal: string
          withdrawableDecimal?: string
          voteLockedDecimal?: string
          voteLockedRaw?: string
          voteLockBreakdown?: unknown
        }
        setBalanceDecimal(d.balanceDecimal)
        setWithdrawableDecimal(typeof d.withdrawableDecimal === 'string' ? d.withdrawableDecimal : null)
        setVoteLockedDecimal(typeof d.voteLockedDecimal === 'string' ? d.voteLockedDecimal : null)
        setVoteLockedRaw(typeof d.voteLockedRaw === 'string' ? d.voteLockedRaw : null)
        setVoteLockBreakdown(parseVoteLockBreakdown(d.voteLockBreakdown))
      } else {
        setBalanceDecimal(null)
        setWithdrawableDecimal(null)
        setVoteLockedDecimal(null)
        setVoteLockedRaw(null)
        setVoteLockBreakdown([])
      }
    } finally {
      setBalanceLoading(false)
    }
  }, [config, wallet, sessionMatches])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const depositAmountRaw = useCallback(
    async (amountRaw: bigint, busyKind: 'dep' | 'depAll' = 'dep') => {
      if (!config || !publicKey || !connected || !sendTransaction) {
        setMsg('Connect your wallet first.')
        return
      }
      if (!sessionMatches) {
        setMsg('Sign in with the same wallet (use the Voting section) so deposits can be credited to your account.')
        return
      }
      const minRaw = owlUiToRawBigint(config.minDepositUi, config.decimals)
      if (amountRaw < minRaw) {
        setMsg(`Deposit at least ${config.minDepositUi} ${OWL_TICKER}.`)
        return
      }

      setBusy(busyKind)
      try {
        const mint = new PublicKey(config.owlMint)
        const escrowPk = new PublicKey(config.escrowAddress)

        const senderAta = await getAssociatedTokenAddress(mint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
        const recipientAta = await getAssociatedTokenAddress(
          mint,
          escrowPk,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: publicKey })

        try {
          await getAccount(connection, recipientAta, 'confirmed', TOKEN_PROGRAM_ID)
        } catch {
          transaction.add(
            createAssociatedTokenAccountInstruction(publicKey, recipientAta, escrowPk, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
          )
        }

        transaction.add(createTransferInstruction(senderAta, recipientAta, publicKey, amountRaw, [], TOKEN_PROGRAM_ID))

        const signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        })

        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

        const res = await fetch('/api/council/escrow/confirm-deposit', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', [HEADER]: wallet },
          body: JSON.stringify({ signature }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setMsg(typeof json.error === 'string' ? json.error : 'Could not confirm deposit')
          return
        }
        setDepositUi('')
        setMsg('Deposit credited. You can vote with this balance while it stays in voting stake, or withdraw after votes.')
        await refreshBalance()
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Deposit failed')
      } finally {
        setBusy(null)
      }
    },
    [config, publicKey, connected, sendTransaction, connection, wallet, sessionMatches, refreshBalance]
  )

  const depositOwl = useCallback(async () => {
    setMsg(null)
    if (!config) return
    const ui = Number.parseFloat(depositUi.trim())
    if (!Number.isFinite(ui) || ui < config.minDepositUi) {
      setMsg(`Deposit at least ${config.minDepositUi} ${OWL_TICKER}.`)
      return
    }

    const amountRaw = owlUiToRawBigint(ui, config.decimals)
    if (amountRaw <= 0n) {
      setMsg('Invalid amount.')
      return
    }

    await depositAmountRaw(amountRaw)
  }, [config, depositUi, depositAmountRaw])

  const stakeAllOwl = useCallback(async () => {
    setMsg(null)
    if (!config || !publicKey || !connected || !sendTransaction) {
      setMsg('Connect your wallet first.')
      return
    }
    if (!sessionMatches) {
      setMsg('Sign in with the same wallet (use the Voting section) so deposits can be credited to your account.')
      return
    }

    try {
      const mint = new PublicKey(config.owlMint)
      const senderAta = await getAssociatedTokenAddress(mint, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
      let amountRaw: bigint
      try {
        const acct = await getAccount(connection, senderAta, 'confirmed', TOKEN_PROGRAM_ID)
        amountRaw = acct.amount
      } catch {
        setMsg(`No ${OWL_TICKER} in your wallet token account (or account not created).`)
        return
      }
      if (amountRaw <= 0n) {
        setMsg(`You have no ${OWL_TICKER} in your wallet to stake.`)
        return
      }
      const minRaw = owlUiToRawBigint(config.minDepositUi, config.decimals)
      if (amountRaw < minRaw) {
        setMsg(
          `Wallet has ${owlRawToDecimalString(amountRaw, config.decimals)} ${OWL_TICKER}; minimum stake is ${config.minDepositUi} ${OWL_TICKER}.`
        )
        return
      }

      setDepositUi(owlRawToDecimalString(amountRaw, config.decimals))
      await depositAmountRaw(amountRaw, 'depAll')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not read wallet balance')
    }
  }, [config, publicKey, connected, sendTransaction, connection, sessionMatches, depositAmountRaw])

  const withdraw = useCallback(
    async (all: boolean) => {
      setMsg(null)
      if (!config || !wallet || !sessionMatches) {
        setMsg('Sign in with the same wallet as connected (see Voting) to withdraw.')
        return
      }

      try {
        if (voteLockedRaw !== null && voteLockedRaw !== '' && BigInt(voteLockedRaw) > 0n) {
          setMsg(
            `Your ${OWL_TICKER} is locked in an active proposal vote. Withdraw is disabled until that voting ends.`
          )
          return
        }
      } catch {
        /* ignore malformed raw */
      }

      setBusy(all ? 'wdAll' : 'wd')
      try {
        let jsonBody: Record<string, unknown>
        if (all) {
          jsonBody = { withdrawAll: true }
        } else {
          const amountUi = Number.parseFloat(withdrawUi.trim())
          if (!Number.isFinite(amountUi) || amountUi <= 0) {
            setMsg(`Enter a valid ${OWL_TICKER} amount to withdraw.`)
            setBusy(null)
            return
          }
          jsonBody = { amountUi }
        }

        const res = await fetch('/api/council/escrow/withdraw', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', [HEADER]: wallet },
          body: JSON.stringify(jsonBody),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setMsg(typeof json.error === 'string' ? json.error : 'Withdraw failed')
          return
        }
        setWithdrawUi('')
        setMsg(`${OWL_TICKER} sent back to your wallet.`)
        await refreshBalance()
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Withdraw failed')
      } finally {
        setBusy(null)
      }
    },
    [config, wallet, sessionMatches, withdrawUi, refreshBalance, voteLockedRaw]
  )

  let hasActiveVoteLock = false
  let voteLockedAmountIsZero = true
  try {
    hasActiveVoteLock = Boolean(voteLockedRaw && BigInt(voteLockedRaw) > 0n)
    voteLockedAmountIsZero = !voteLockedRaw || voteLockedRaw.trim() === '' || BigInt(voteLockedRaw) === 0n
  } catch {
    hasActiveVoteLock = false
    voteLockedAmountIsZero = true
  }

  if (configLoading) {
    return (
      <section
        id="council-owl-escrow"
        className="mb-8 scroll-mt-24 sm:scroll-mt-28 flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-4 py-8"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-7 w-7 animate-spin text-emerald-400/90" aria-hidden />
        <p className="text-center text-xs text-muted-foreground px-4 max-w-sm">Loading voting stake…</p>
      </section>
    )
  }

  if (!configLoading && !config && configFetchFailed) {
    return (
      <section
        id="council-owl-escrow"
        className="mb-8 scroll-mt-24 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-4 sm:px-5"
      >
        <h2 className="text-sm font-semibold text-destructive">Voting stake could not load</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Check your connection and try again. If this keeps happening on mobile, try disabling VPN or switching network.
        </p>
        <Button type="button" variant="secondary" className="mt-3 min-h-[44px]" onClick={() => void loadEscrowConfig()}>
          Retry
        </Button>
      </section>
    )
  }

  if (!config && escrowUnavailableReason) {
    const human =
      ESCROW_DISABLED_COPY[escrowUnavailableReason] ??
      (escrowUnavailableReason === 'disabled'
        ? 'Council voting stake is not available from the API.'
        : `Council voting stake unavailable (${escrowUnavailableReason}).`)
    return (
      <section
        id="council-owl-escrow"
        className="mb-8 scroll-mt-24 rounded-xl border border-amber-500/35 bg-amber-950/15 px-4 py-4 sm:px-5"
      >
        <h2 className="text-sm font-semibold text-amber-100">Council {OWL_TICKER} voting stake</h2>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{human}</p>
        <Button type="button" variant="secondary" className="mt-3 min-h-[44px]" onClick={() => void loadEscrowConfig()}>
          Retry
        </Button>
      </section>
    )
  }

  if (!config) {
    return (
      <section
        id="council-owl-escrow"
        className="mb-8 scroll-mt-24 rounded-xl border border-border/60 bg-muted/20 px-4 py-4 sm:px-5"
      >
        <h2 className="text-sm font-semibold text-foreground">Council {OWL_TICKER} voting stake</h2>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Voting stake settings could not be loaded. Try refreshing the page.
        </p>
        <Button type="button" variant="secondary" className="mt-3 min-h-[44px]" onClick={() => void loadEscrowConfig()}>
          Retry
        </Button>
      </section>
    )
  }

  return (
    <section
      id="council-owl-escrow"
      className="mb-8 sm:mb-10 min-w-0 max-w-full scroll-mt-24 sm:scroll-mt-28"
      aria-labelledby="council-escrow-heading"
    >
      <div className="rev-share-pool-card mx-auto w-full max-w-[420px] rounded-xl p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <Landmark
            className="mt-0.5 h-5 w-5 shrink-0 text-theme-prime drop-shadow-[0_0_6px_rgba(0,255,136,0.5)]"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2
              id="council-escrow-heading"
              className="text-sm font-semibold uppercase tracking-wider text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.4)]"
            >
              Council {OWL_TICKER} voting stake
            </h2>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Vote weight uses {OWL_TICKER} you move into voting stake (not loose wallet balance). {OWL_TICKER} that backs an open vote
              you cast stays locked until that proposal closes; then you can withdraw what is not locked.
            </p>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-500/15 bg-black/20 px-2.5 py-1.5 text-[11px] text-muted-foreground [-webkit-overflow-scrolling:touch]">
          <span className="font-mono whitespace-nowrap sm:whitespace-normal sm:break-all">
            Receiving wallet · {config.escrowAddress}
          </span>
        </div>

        {!sessionMatches ? (
          <div className="mt-4 space-y-3 rounded-xl border border-amber-500/35 bg-amber-950/25 px-3 py-3">
            {connected ? (
              <p className="text-xs text-amber-100/95 leading-relaxed">
                {sessionWallet && wallet && sessionWallet !== wallet
                  ? 'Your connected wallet does not match your signed-in wallet. Switch accounts in your wallet app, or sign in again with the wallet you want to use for council.'
                  : 'Confirm the one-time sign-in message so deposits are credited to your wallet (same session as voting).'}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use the wallet button in the header to connect, then sign in below.
              </p>
            )}
            {connected ? (
              <>
                {siwsError ? <p className="text-xs text-destructive">{siwsError}</p> : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-[44px] w-full touch-manipulation"
                  disabled={siwsSigningIn || !signMessage}
                  onClick={() => void siwsSignIn()}
                >
                  {siwsSigningIn ? (
                    <>
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                      Signing…
                    </>
                  ) : (
                    'Sign in with wallet'
                  )}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Jupiter-style: wallet → voting stake */}
        <div className="relative mt-5 rounded-xl border border-emerald-500/20 bg-black/30 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Your wallet</span>
            <span className="font-medium text-theme-prime/90">{OWL_TICKER}</span>
          </div>
          <Label htmlFor="council-dep" className="sr-only">
            Amount to add from wallet
          </Label>
          <Input
            id="council-dep"
            inputMode="decimal"
            className="touch-manipulation mt-2 border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
            placeholder={`min ${config.minDepositUi}`}
            value={depositUi}
            onChange={(e) => setDepositUi(e.target.value)}
            disabled={busy !== null || !connected || !sessionMatches}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full touch-manipulation border-emerald-500/35 sm:flex-1"
              disabled={busy !== null || !connected || !sessionMatches}
              onClick={() => void stakeAllOwl()}
            >
              {busy === 'depAll' ? (
                <>
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                  Staking…
                </>
              ) : (
                'Stake all'
              )}
            </Button>
            <Button
              type="button"
              className="min-h-[44px] w-full touch-manipulation shadow-[0_0_18px_rgba(0,255,136,0.12)] sm:flex-1"
              disabled={busy !== null || !connected || !sessionMatches}
              onClick={() => void depositOwl()}
            >
              {busy === 'dep' ? (
                <>
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                'Add to voting stake'
              )}
            </Button>
          </div>
        </div>

        <div className="relative z-[1] flex justify-center -my-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-emerald-500/45 bg-[linear-gradient(145deg,rgba(10,28,18,0.98),rgba(6,18,12,0.98))] shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
            aria-hidden
          >
            <ArrowDown className="h-5 w-5 text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.45)]" />
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-black/30 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Voting stake balance</span>
            {balanceLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <span className="font-medium text-theme-prime/90">{OWL_TICKER}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
            <span className="pool-value-glow text-2xl font-bold tabular-nums text-theme-prime sm:text-3xl">
              {sessionMatches ? (balanceDecimal ?? '—') : '—'}
            </span>
            {sessionMatches && balanceDecimal ? (
              <span className="text-lg font-semibold text-theme-prime/85">{OWL_TICKER}</span>
            ) : null}
          </div>

          {sessionMatches && !balanceLoading && voteLockedDecimal && withdrawableDecimal ? (
            <div className="mt-3 space-y-2 border-t border-emerald-500/15 pt-3 text-xs text-muted-foreground leading-relaxed">
              <p>
                {voteLockedAmountIsZero ? (
                  <>
                    No {OWL_TICKER} from voting stake is earmarked for proposals that still have voting{' '}
                    <span className="font-medium text-foreground/85">open</span> right now.
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-medium text-foreground/90">
                      {voteLockedDecimal} {OWL_TICKER}
                    </span>{' '}
                    backs open votes you already cast — it stays in voting stake until those proposals finish.
                  </>
                )}
              </p>
              <p>
                <span className="tabular-nums font-medium text-emerald-200/95">
                  {withdrawableDecimal} {OWL_TICKER}
                </span>{' '}
                is stake not backing open votes — that is what you may return to your wallet below when withdrawal is
                enabled (withdraw is paused while any amount stays locked above).
              </p>
            </div>
          ) : null}

          {sessionMatches && !balanceLoading && voteLockBreakdown.length > 0 ? (
            <div className="mt-3 rounded-lg border border-emerald-500/20 bg-black/25 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Your weight per open proposal
              </p>
              <ul className="mt-2.5 space-y-2.5">
                {voteLockBreakdown.map((row) => (
                  <li
                    key={row.proposalId}
                    className="flex flex-col gap-1 border-b border-emerald-500/10 pb-2.5 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                  >
                    <Link
                      href={`/council/${encodeURIComponent(row.slug)}`}
                      className="min-w-0 text-sm font-medium text-emerald-100/95 underline-offset-2 hover:underline"
                      title={row.title}
                    >
                      <span className="line-clamp-2">{row.title}</span>
                    </Link>
                    <span className="shrink-0 tabular-nums text-sm font-semibold text-foreground/95 sm:pt-0.5">
                      {row.lockedDecimal} {OWL_TICKER}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 space-y-2 border-t border-emerald-500/15 pt-4">
            <Label htmlFor="council-wd" className="text-xs text-muted-foreground">
              Withdraw to wallet
            </Label>
            {sessionMatches && hasActiveVoteLock ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/95 leading-relaxed">
                Your {OWL_TICKER} is locked because you have an active vote on an open proposal. Withdraw is unavailable
                until that voting ends.
              </p>
            ) : null}
            <Input
              id="council-wd"
              inputMode="decimal"
              className="touch-manipulation rounded-lg border-emerald-500/25 bg-background/50 text-base"
              placeholder="Amount"
              value={withdrawUi}
              onChange={(e) => setWithdrawUi(e.target.value)}
              disabled={busy !== null || !sessionMatches || hasActiveVoteLock}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] flex-1 touch-manipulation"
                disabled={busy !== null || !sessionMatches || hasActiveVoteLock}
                onClick={() => void withdraw(false)}
              >
                {busy === 'wd' ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden /> : null}
                Withdraw amount
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] flex-1 touch-manipulation border-emerald-500/35"
                disabled={busy !== null || !sessionMatches || hasActiveVoteLock}
                onClick={() => void withdraw(true)}
              >
                {busy === 'wdAll' ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden /> : null}
                Withdraw all
              </Button>
            </div>
          </div>
        </div>

        {msg ? <p className="mt-4 text-center text-sm text-emerald-100/95">{msg}</p> : null}
      </div>
    </section>
  )
}

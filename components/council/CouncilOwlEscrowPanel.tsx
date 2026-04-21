'use client'

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
import { Loader2 } from 'lucide-react'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'

const HEADER = 'X-Connected-Wallet'

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
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [depositUi, setDepositUi] = useState('')
  const [withdrawUi, setWithdrawUi] = useState('')
  const [busy, setBusy] = useState<'dep' | 'wd' | 'wdAll' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setConfigLoading(true)
    fetch('/api/council/escrow', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((data: { enabled?: boolean; escrowAddress?: string; owlMint?: string; decimals?: number; minDepositUi?: number }) => {
        if (cancelled) return
        if (data.enabled === true && data.escrowAddress && data.owlMint && typeof data.decimals === 'number') {
          setConfig({
            enabled: true,
            escrowAddress: data.escrowAddress,
            owlMint: data.owlMint,
            decimals: data.decimals,
            minDepositUi: typeof data.minDepositUi === 'number' ? data.minDepositUi : 1,
          })
        } else {
          setConfig(null)
        }
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sessionMatches = Boolean(sessionWallet && wallet && sessionWallet === wallet)

  const refreshBalance = useCallback(async () => {
    if (!config || !wallet || !sessionMatches) {
      setBalanceDecimal(null)
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
        setBalanceDecimal((data as { balanceDecimal: string }).balanceDecimal)
      } else {
        setBalanceDecimal(null)
      }
    } finally {
      setBalanceLoading(false)
    }
  }, [config, wallet, sessionMatches])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const depositOwl = useCallback(async () => {
    setMsg(null)
    if (!config || !publicKey || !connected || !sendTransaction) {
      setMsg('Connect your wallet first.')
      return
    }
    if (!sessionMatches) {
      setMsg('Sign in with the same wallet (use the Voting section) so deposits can be credited to your account.')
      return
    }
    const ui = Number.parseFloat(depositUi.trim())
    if (!Number.isFinite(ui) || ui < config.minDepositUi) {
      setMsg(`Deposit at least ${config.minDepositUi} OWL.`)
      return
    }

    const amountRaw = owlUiToRawBigint(ui, config.decimals)
    if (amountRaw <= 0n) {
      setMsg('Invalid amount.')
      return
    }

    setBusy('dep')
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

      transaction.add(
        createTransferInstruction(senderAta, recipientAta, publicKey, amountRaw, [], TOKEN_PROGRAM_ID)
      )

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
      setMsg('Deposit credited. You can vote with this escrow balance while it stays here, or withdraw after votes.')
      await refreshBalance()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(null)
    }
  }, [config, publicKey, connected, sendTransaction, connection, depositUi, wallet, sessionMatches, refreshBalance])

  const withdraw = useCallback(
    async (all: boolean) => {
      setMsg(null)
      if (!config || !wallet || !sessionMatches) {
        setMsg('Sign in with the same wallet as connected (see Voting) to withdraw.')
        return
      }

      setBusy(all ? 'wdAll' : 'wd')
      try {
        let jsonBody: Record<string, unknown>
        if (all) {
          jsonBody = { withdrawAll: true }
        } else {
          const amountUi = Number.parseFloat(withdrawUi.trim())
          if (!Number.isFinite(amountUi) || amountUi <= 0) {
            setMsg('Enter a valid OWL amount to withdraw.')
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
        setMsg('OWL sent back to your wallet.')
        await refreshBalance()
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Withdraw failed')
      } finally {
        setBusy(null)
      }
    },
    [config, wallet, sessionMatches, withdrawUi, refreshBalance]
  )

  if (configLoading) {
    return (
      <div className="mb-8 flex justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    )
  }

  if (!config) {
    return null
  }

  return (
    <section
      className="mb-8 sm:mb-10 rounded-xl border border-emerald-500/30 bg-emerald-950/15 px-4 py-4 sm:px-5 sm:py-5"
      aria-labelledby="council-escrow-heading"
    >
      <h2 id="council-escrow-heading" className="text-sm font-semibold uppercase tracking-wider text-emerald-200/90">
        Council OWL escrow (voting stake)
      </h2>
      <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
        Vote weight uses OWL you keep in this escrow (not your free wallet balance). After a vote ends, your OWL stays
        here for the next proposal unless you withdraw it to your wallet.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono break-all">Escrow: {config.escrowAddress}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-muted-foreground">Your credited balance</span>
        {balanceLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <span className="text-lg font-medium text-emerald-100 tabular-nums">
            {sessionMatches ? (balanceDecimal ?? '—') : '—'} OWL
          </span>
        )}
      </div>
      {!sessionMatches ? (
        <div className="mt-3 space-y-3 rounded-lg border border-amber-500/35 bg-amber-950/20 px-3 py-3">
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
                className="min-h-[44px] w-full touch-manipulation sm:w-auto"
                disabled={siwsSigningIn || !signMessage}
                onClick={() => void siwsSignIn()}
              >
                {siwsSigningIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2 inline" aria-hidden />
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/50 bg-background/40 p-3">
          <Label htmlFor="council-dep">Deposit OWL</Label>
          <Input
            id="council-dep"
            inputMode="decimal"
            className="touch-manipulation"
            placeholder={`min ${config.minDepositUi}`}
            value={depositUi}
            onChange={(e) => setDepositUi(e.target.value)}
          />
          <Button
            type="button"
            className="min-h-[44px] w-full touch-manipulation"
            disabled={busy !== null || !connected || !sessionMatches}
            onClick={() => void depositOwl()}
          >
            {busy === 'dep' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Send OWL to escrow'}
          </Button>
        </div>
        <div className="space-y-2 rounded-lg border border-border/50 bg-background/40 p-3">
          <Label htmlFor="council-wd">Withdraw OWL</Label>
          <Input
            id="council-wd"
            inputMode="decimal"
            className="touch-manipulation"
            placeholder="amount"
            value={withdrawUi}
            onChange={(e) => setWithdrawUi(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-[44px] w-full touch-manipulation"
              disabled={busy !== null || !sessionMatches}
              onClick={() => void withdraw(false)}
            >
              {busy === 'wd' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Withdraw amount'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] w-full touch-manipulation"
              disabled={busy !== null || !sessionMatches}
              onClick={() => void withdraw(true)}
            >
              {busy === 'wdAll' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Withdraw all'}
            </Button>
          </div>
        </div>
      </div>

      {msg ? <p className="mt-3 text-sm text-emerald-100/95">{msg}</p> : null}
    </section>
  )
}

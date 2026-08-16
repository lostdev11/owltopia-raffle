'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, RefreshCw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { OwlSendLedgerRow } from '@/lib/db/owl-send-ledger'
import { ledgerModeLabel, OwlSendSolscanTxUrl } from '@/lib/owl-send/record-ledger'
import { formatOwlSendFeeSol } from '@/lib/owl-send/fee'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import {
  describeInvalidSolanaTxSignatureInput,
  isValidSolanaTxSignatureBase58,
  normalizeDepositTxSignatureInput,
} from '@/lib/raffles/verify-prize-deposit-client'
import { cn } from '@/lib/utils'

/** Collapse control appears once the ledger has this many rows. */
const LEDGER_COLLAPSE_AT = 5
/** When expanded past this count, show a shorter preview + “Show all”. */
const LEDGER_PREVIEW_COUNT = 5

function shorten(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

type Props = {
  wallet: string | null
  /** Bump to refresh after a successful send. */
  refreshKey?: number
}

export function OwlSendLedgerPanel({ wallet, refreshKey = 0 }: Props) {
  const { sessionWallet, checking, checkSession } = useSiwsSession()
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()
  const [rows, setRows] = useState<OwlSendLedgerRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Full list open vs collapsed to header summary. */
  const [expanded, setExpanded] = useState(true)
  /** When expanded and list is long, whether to show every row. */
  const [showAll, setShowAll] = useState(false)
  const [recoverOpen, setRecoverOpen] = useState(false)
  const [recoverSig, setRecoverSig] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [recoverError, setRecoverError] = useState<string | null>(null)
  const [recoverNotice, setRecoverNotice] = useState<string | null>(null)
  const didAutoCollapse = useRef(false)

  const signedInAsWallet =
    !!wallet && !!sessionWallet && sessionWallet === wallet

  const canCollapse = rows.length >= LEDGER_COLLAPSE_AT
  const visibleRows =
    expanded && canCollapse && !showAll ? rows.slice(0, LEDGER_PREVIEW_COUNT) : rows
  const hiddenCount = expanded && canCollapse && !showAll ? rows.length - visibleRows.length : 0

  const load = useCallback(async () => {
    if (!wallet) {
      setRows([])
      return
    }
    if (!signedInAsWallet) {
      setRows([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/owl-send/ledger?limit=40`, {
        cache: 'no-store',
        credentials: 'include',
        headers: { 'x-connected-wallet': wallet },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Failed to load ledger')
        setRows([])
        return
      }
      setRows(Array.isArray(data?.sends) ? data.sends : [])
    } catch {
      setError('Failed to load ledger')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [wallet, signedInAsWallet])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const recoverSend = useCallback(async () => {
    if (!wallet || !signedInAsWallet) return
    const txSignature = normalizeDepositTxSignatureInput(recoverSig)
    const invalidReason = describeInvalidSolanaTxSignatureInput(recoverSig)
    if (!isValidSolanaTxSignatureBase58(txSignature)) {
      setRecoverError(invalidReason || 'Paste a transaction signature (or Solscan tx URL).')
      return
    }
    setRecovering(true)
    setRecoverError(null)
    setRecoverNotice(null)
    try {
      const res = await fetch('/api/owl-send/ledger/recover', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-connected-wallet': wallet,
        },
        body: JSON.stringify({ txSignature }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setRecoverError(typeof data?.error === 'string' ? data.error : 'Could not recover send')
        return
      }
      setRecoverSig('')
      setRecoverNotice(
        data?.duplicate
          ? 'That send was already in your ledger.'
          : 'Send recovered and added to your ledger.'
      )
      await load()
    } catch {
      setRecoverError('Could not recover send')
    } finally {
      setRecovering(false)
    }
  }, [wallet, signedInAsWallet, recoverSig, load])

  // First time the list crosses the threshold, collapse so the send UI stays usable on mobile.
  useEffect(() => {
    if (rows.length >= LEDGER_COLLAPSE_AT && !didAutoCollapse.current) {
      didAutoCollapse.current = true
      setExpanded(false)
      setShowAll(false)
    }
    if (rows.length < LEDGER_COLLAPSE_AT) {
      didAutoCollapse.current = false
      setExpanded(true)
      setShowAll(false)
    }
  }, [rows.length])

  // After a new send, briefly reveal the list so the latest entry is visible.
  useEffect(() => {
    if (refreshKey > 0 && rows.length > 0) {
      setExpanded(true)
      setShowAll(false)
    }
  }, [refreshKey, rows.length])

  if (!wallet) return null

  return (
    <Card className="border-white/10 bg-black/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          {canCollapse ? (
            <button
              type="button"
              className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 touch-manipulation text-left"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="h-4 w-4 shrink-0" />
                Send ledger
                <span className="font-normal text-muted-foreground">({rows.length})</span>
              </CardTitle>
              <ChevronDown
                className={cn(
                  'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-180'
                )}
              />
            </button>
          ) : (
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" />
              Send ledger
              {rows.length > 0 ? (
                <span className="font-normal text-muted-foreground">({rows.length})</span>
              ) : null}
            </CardTitle>
          )}
          {signedInAsWallet ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px] shrink-0 touch-manipulation"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh ledger"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
        {expanded || !canCollapse ? (
          <CardDescription>
            Confirmed OwlSend transfers from this wallet (newest first). Sign in to view.
          </CardDescription>
        ) : (
          <CardDescription>
            {rows.length} send{rows.length === 1 ? '' : 's'} · tap header to expand
          </CardDescription>
        )}
      </CardHeader>
      {(expanded || !canCollapse) && (
        <CardContent className="space-y-2">
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking session…
            </p>
          ) : null}

          {!checking && !signedInAsWallet ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Sign in with Solana to view your private send history.
              </p>
              {signInError ? <p className="text-sm text-red-300">{signInError}</p> : null}
              <Button
                type="button"
                variant="secondary"
                className="min-h-[44px] w-full touch-manipulation sm:w-auto"
                disabled={signingIn}
                onClick={() =>
                  void signIn({
                    onSuccess: async () => {
                      await checkSession()
                    },
                  })
                }
              >
                {signingIn ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  'Sign in to view ledger'
                )}
              </Button>
            </div>
          ) : null}

          {signedInAsWallet ? (
            <>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
              {loading && rows.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </p>
              ) : null}
              {!loading && rows.length === 0 && !error ? (
                <p className="text-sm text-muted-foreground">No sends recorded yet for this wallet.</p>
              ) : null}
              <ul className="space-y-2">
                {visibleRows.map((row) => {
                  const feeSol =
                    row.fee_lamports != null && row.fee_lamports > 0
                      ? row.fee_lamports / LAMPORTS_PER_SOL
                      : null
                  const first = row.lines[0]
                  const detail =
                    row.asset_kind === 'nft'
                      ? `${row.asset_count} NFT${row.asset_count === 1 ? '' : 's'} → ${row.recipient_count} wallet${row.recipient_count === 1 ? '' : 's'}`
                      : `${row.asset_count} transfer${row.asset_count === 1 ? '' : 's'} → ${row.recipient_count} wallet${row.recipient_count === 1 ? '' : 's'}`
                  return (
                    <li
                      key={row.id}
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium text-white">{ledgerModeLabel(row.mode)}</p>
                          <p className="text-xs text-muted-foreground">
                            {detail}
                            {first?.name || first?.symbol
                              ? ` · ${first.name || first.symbol}${row.lines.length > 1 ? ' +more' : ''}`
                              : ''}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatWhen(row.created_at)}
                            {feeSol != null ? ` · ${formatOwlSendFeeSol(feeSol)} fee` : ''}
                            {row.batch_index != null ? ` · batch ${row.batch_index + 1}` : ''}
                          </p>
                          {row.lines.length <= 3 ? (
                            <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                              {row.lines.map((l, i) => (
                                <li key={`${row.id}-${i}`}>
                                  {l.name || l.symbol || (l.mint ? shorten(l.mint) : 'asset')} →{' '}
                                  {shorten(l.recipient)}
                                  {l.amount_raw && l.decimals != null
                                    ? ` · ${(Number(l.amount_raw) / 10 ** l.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
                                    : ''}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <a
                          href={OwlSendSolscanTxUrl(row.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-1 text-xs text-theme-prime touch-manipulation"
                        >
                          Solscan <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {hiddenCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-[44px] w-full touch-manipulation text-sm text-muted-foreground"
                  onClick={() => setShowAll(true)}
                >
                  Show all {rows.length} sends
                </Button>
              ) : null}
              {showAll && canCollapse && rows.length > LEDGER_PREVIEW_COUNT ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-[44px] w-full touch-manipulation text-sm text-muted-foreground"
                  onClick={() => setShowAll(false)}
                >
                  Show fewer
                </Button>
              ) : null}

              <div className="border-t border-white/10 pt-3">
                <button
                  type="button"
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 touch-manipulation text-left text-sm text-muted-foreground"
                  aria-expanded={recoverOpen}
                  onClick={() => setRecoverOpen((v) => !v)}
                >
                  Missing a send?
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform',
                      recoverOpen && 'rotate-180'
                    )}
                  />
                </button>
                {recoverOpen ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Paste the Solscan URL or full signature for an OwlSend from this wallet (e.g. MPL
                      Core). If Discord split the sig, paste the Solscan link.
                    </p>
                    <textarea
                      value={recoverSig}
                      onChange={(e) => {
                        setRecoverSig(e.target.value)
                        setRecoverError(null)
                        setRecoverNotice(null)
                      }}
                      placeholder="Transaction signature or Solscan URL"
                      aria-label="OwlSend transaction signature"
                      rows={3}
                      className="min-h-[88px] w-full resize-y touch-manipulation rounded-shape-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed break-all text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={recovering}
                      inputMode="text"
                    />
                    {recoverError ? <p className="text-sm text-red-300">{recoverError}</p> : null}
                    {recoverNotice ? (
                      <p className="text-sm text-emerald-300/90">{recoverNotice}</p>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-[44px] w-full touch-manipulation sm:w-auto"
                      disabled={recovering || recoverSig.trim().length < 32}
                      onClick={() => void recoverSend()}
                    >
                      {recovering ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recovering…
                        </>
                      ) : (
                        'Recover send'
                      )}
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      )}
    </Card>
  )
}

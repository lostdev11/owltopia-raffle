'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ExternalLink, Loader2, RefreshCw, ScrollText } from 'lucide-react'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { cn } from '@/lib/utils'

export type PackLedgerRow = {
  id: string
  completedAt: string
  productName: string
  productSlug: string
  category: string
  prizeLabel: string
  paymentSignature: string | null
  payoutSignature: string | null
  isJackpotWin: boolean
}

const PAGE_SIZE = 15

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

function categoryChip(category: string, isJackpot: boolean): string {
  if (isJackpot || category === 'jackpot') return 'Jackpot'
  if (category === 'sol') return 'SOL'
  if (category === 'nft') return 'NFT'
  return '$OWL'
}

function solscanTx(sig: string | null): string | null {
  if (!sig?.trim()) return null
  return `https://solscan.io/tx/${encodeURIComponent(sig.trim())}`
}

type Props = {
  wallet: string | null
  /** Bump after a successful open to refresh totals and list. */
  refreshKey?: number
}

export function PackLedgerPanel({ wallet, refreshKey = 0 }: Props) {
  const { sessionWallet, checking, checkSession } = useSiwsSession()
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()
  const [rows, setRows] = useState<PackLedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const signedInAsWallet =
    !!wallet && !!sessionWallet && sessionWallet === wallet

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!wallet || !signedInAsWallet) {
        setRows([])
        setTotal(0)
        return
      }
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/packs/ledger?limit=${PAGE_SIZE}&offset=${nextOffset}`,
          {
            cache: 'no-store',
            credentials: 'include',
            headers: { 'x-connected-wallet': wallet },
          }
        )
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          setError(typeof data?.error === 'string' ? data.error : 'Failed to load ledger')
          if (!append) {
            setRows([])
            setTotal(0)
          }
          return
        }
        const opens = Array.isArray(data?.opens) ? (data.opens as PackLedgerRow[]) : []
        setTotal(typeof data?.total === 'number' ? data.total : opens.length)
        setOffset(nextOffset)
        setRows((prev) => (append ? [...prev, ...opens] : opens))
      } catch {
        setError('Failed to load ledger')
        if (!append) {
          setRows([])
          setTotal(0)
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [wallet, signedInAsWallet]
  )

  useEffect(() => {
    void loadPage(0, false)
  }, [loadPage, refreshKey])

  if (!wallet) {
    return (
      <div
        id="my-pack-opens"
        className="scroll-mt-24 rounded-2xl border border-[#00FF9C]/20 bg-black/45 p-5 text-center sm:p-6"
      >
        <p className="text-sm text-white/55">Connect a wallet to see your pack open history.</p>
      </div>
    )
  }

  return (
    <div
      id="my-pack-opens"
      className="scroll-mt-24 rounded-2xl border border-[#00FF9C]/20 bg-black/45 p-4 shadow-[0_0_40px_-20px_rgba(0,255,156,0.35)] backdrop-blur-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 touch-manipulation text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ScrollText className="h-5 w-5 shrink-0 text-[#00FF9C]" aria-hidden />
          <div className="min-w-0">
            <h2 className="font-display text-xl tracking-[0.08em] text-[#EAFBF4] sm:text-2xl">
              My pack opens
            </h2>
            <p className="mt-0.5 text-xs text-white/50">
              {signedInAsWallet
                ? `${total} pack${total === 1 ? '' : 's'} opened with this wallet`
                : 'Sign in to view your private history'}
            </p>
          </div>
          <ChevronDown
            className={cn(
              'ml-auto h-5 w-5 shrink-0 text-white/45 transition-transform',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
        {signedInAsWallet ? (
          <button
            type="button"
            onClick={() => void loadPage(0, false)}
            disabled={loading}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-white/10 text-[#00FF9C]/80 hover:bg-[#00FF9C]/10 disabled:opacity-50"
            aria-label="Refresh pack ledger"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3">
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-white/55">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Checking session…
            </p>
          ) : null}

          {!checking && !signedInAsWallet ? (
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm leading-relaxed text-white/60">
                Sign in with Solana to view pack opens for your connected wallet only.
              </p>
              {signInError ? <p className="text-sm text-red-300">{signInError}</p> : null}
              <button
                type="button"
                disabled={signingIn}
                onClick={() =>
                  void signIn({
                    onSuccess: async () => {
                      await checkSession()
                    },
                  })
                }
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#00FF9C]/15 px-4 text-sm font-semibold text-[#00FF9C] ring-1 ring-[#00FF9C]/35 hover:bg-[#00FF9C]/25 disabled:opacity-50 sm:w-auto"
              >
                {signingIn ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  'Sign in to view ledger'
                )}
              </button>
            </div>
          ) : null}

          {signedInAsWallet ? (
            <>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
              {!loading && rows.length === 0 && !error ? (
                <p className="rounded-xl border border-dashed border-white/15 py-8 text-center text-sm text-white/50">
                  No packs opened yet — rip one above to start your ledger.
                </p>
              ) : null}
              <ul className="divide-y divide-white/8">
                {rows.map((row) => {
                  const txSig = row.payoutSignature || row.paymentSignature
                  const txUrl = solscanTx(txSig)
                  return (
                    <li key={row.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-white/45">{formatWhen(row.completedAt)}</p>
                        <p className="mt-0.5 text-sm text-white/70">
                          {row.productName}
                          <span className="mx-2 text-white/25">·</span>
                          <span className="text-[#00FF9C]/85">
                            {categoryChip(row.category, row.isJackpotWin)}
                          </span>
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#EAFBF4]">
                          {row.isJackpotWin ? (
                            <span className="text-amber-200">🏆 {row.prizeLabel}</span>
                          ) : (
                            row.prizeLabel
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-3">
                        <Link
                          href={`/packs/verify/${row.id}`}
                          className="inline-flex min-h-[44px] items-center text-xs font-semibold uppercase tracking-[0.16em] text-[#00FF9C] hover:text-[#7DFFB8]"
                        >
                          Verify
                        </Link>
                        {txUrl ? (
                          <a
                            href={txUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[44px] items-center gap-1 text-xs text-white/55 hover:text-white/80"
                          >
                            Tx
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {rows.length < total ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadPage(offset + PAGE_SIZE, true)}
                  className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[#00FF9C]/30 px-4 text-sm font-semibold text-[#00FF9C] hover:bg-[#00FF9C]/10 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Loading…
                    </>
                  ) : (
                    `Load more (${rows.length} of ${total})`
                  )}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

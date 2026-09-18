'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Loader2 } from 'lucide-react'
import {
  ticketRefundSourceLabel,
  type TicketRefundLedgerRow,
} from '@/lib/db/ticket-refund-ledger'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { cn } from '@/lib/utils'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatAmount(amount: number, currency: string): string {
  const n = Number.isFinite(amount) ? amount : 0
  const cur = (currency || 'SOL').toUpperCase()
  if (cur === 'USDC') return `${n.toFixed(2)} USDC`
  if (cur === 'SOL') return `${n.toFixed(4)} SOL`
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${cur}`
}

type Props = {
  className?: string
}

/**
 * Mobile-first collapsible list of completed ticket refunds for the signed-in wallet.
 */
export function DashboardTicketRefundLedger({ className }: Props) {
  const [refunds, setRefunds] = useState<TicketRefundLedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/me/refund-history?limit=40', { credentials: 'include' })
      const json = (await res.json().catch(() => ({}))) as {
        refunds?: TicketRefundLedgerRow[]
        error?: string
      }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load refund history')
        setRefunds([])
        return
      }
      setRefunds(Array.isArray(json.refunds) ? json.refunds : [])
    } catch {
      setError('Could not load refund history')
      setRefunds([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const collapsedSummary = useMemo(() => {
    if (loading) return 'Loading…'
    if (error) return error
    if (refunds.length === 0) return 'No ticket refunds sent yet'
    const latest = refunds[0]
    return `${refunds.length} refund${refunds.length === 1 ? '' : 's'} · latest ${formatAmount(latest.amount, latest.currency)} · ${formatWhen(latest.refunded_at)}`
  }, [error, loading, refunds])

  const devnet = /devnet/i.test(resolvePublicSolanaRpcUrl())
  const contentId = 'dashboard-ticket-refund-ledger'

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-card/30 p-3 text-sm',
        className
      )}
    >
      <button
        type="button"
        className={cn(
          'flex w-full min-h-[44px] touch-manipulation items-start justify-between gap-3 rounded-lg text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50'
        )}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-medium text-foreground">Refund history</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{collapsedSummary}</p>
        </div>
        {loading ? (
          <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown
            className={cn(
              'mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
        )}
      </button>

      {expanded ? (
        <div id={contentId} className="mt-3">
          {refunds.length === 0 && !loading ? (
            <p className="text-xs text-muted-foreground">
              When a raffle fails or is cancelled, refunds show here with the time and transaction link.
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {refunds.map((row) => {
                const sig = row.tx_signature?.trim() ?? ''
                const isOnChain =
                  sig.length >= 64 &&
                  !sig.startsWith('legacy-missing') &&
                  !sig.startsWith('NO_PAYMENT:')
                const explorerHref = isOnChain
                  ? `https://solscan.io/tx/${encodeURIComponent(sig)}${devnet ? '?cluster=devnet' : ''}`
                  : null
                const title = row.raffle_title || 'Raffle'
                const slug = row.raffle_slug

                return (
                  <li key={row.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        {slug ? (
                          <Link
                            href={`/raffles/${slug}`}
                            className="font-medium text-foreground hover:underline truncate block"
                          >
                            {title}
                          </Link>
                        ) : (
                          <p className="font-medium text-foreground truncate">{title}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatAmount(row.amount, row.currency)} · {formatWhen(row.refunded_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="rounded-md border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {ticketRefundSourceLabel(row.source)}
                        </span>
                        {explorerHref ? (
                          <a
                            href={explorerHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-theme-prime underline-offset-2 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
                          >
                            View tx
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

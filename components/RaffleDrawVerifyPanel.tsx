'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink, ShieldCheck, Loader2 } from 'lucide-react'

type VerifyRange = {
  wallet: string
  tickets: number
  startIndex: number
  endIndex: number
}

type VerifyPayload = {
  status: 'not_drawn' | 'legacy_draw' | 'verified' | 'mismatch'
  ok?: boolean
  error?: string | null
  message?: string
  algo?: string
  drawSeed?: string
  soldCount?: number
  winnerIndex?: number
  winnerWallet?: string
  ledgerHash?: string
  ranges?: VerifyRange[]
  memo?: string
  revealTx?: string | null
  revealTxUrl?: string | null
  howItWorks?: string
}

function shorten(s: string, left = 6, right = 4): string {
  if (s.length <= left + right + 1) return s
  return `${s.slice(0, left)}…${s.slice(-right)}`
}

export function RaffleDrawVerifyPanel({ raffleId }: { raffleId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<VerifyPayload | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/verify-draw`, {
        credentials: 'omit',
      })
      const json = (await res.json()) as VerifyPayload & { error?: string }
      if (!res.ok) {
        setFetchError(json.error || 'Failed to load verify data')
        setData(null)
        return
      }
      setData(json)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load verify data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [raffleId])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  return (
    <div className="w-full sm:w-auto">
      <Button
        variant="outline"
        size="default"
        className="w-full sm:w-auto touch-manipulation min-h-[44px] text-sm sm:text-base"
        onClick={() => setOpen((v) => !v)}
      >
        <ShieldCheck className="mr-2 h-4 w-4 shrink-0" />
        {open ? 'Hide verify draw' : 'Verify draw'}
      </Button>

      {open && (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm space-y-3">
          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking draw…
            </p>
          )}
          {fetchError && <p className="text-destructive">{fetchError}</p>}
          {!loading && data?.status === 'not_drawn' && (
            <p className="text-muted-foreground">{data.message}</p>
          )}
          {!loading && data?.status === 'legacy_draw' && (
            <p className="text-muted-foreground">{data.message}</p>
          )}
          {!loading && (data?.status === 'verified' || data?.status === 'mismatch') && (
            <>
              <p
                className={
                  data.status === 'verified' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-destructive font-medium'
                }
              >
                {data.status === 'verified'
                  ? 'Draw recomputes correctly from the published seed and ticket ledger.'
                  : `Verify failed: ${data.error || 'mismatch'}`}
              </p>
              {data.howItWorks && (
                <p className="text-muted-foreground text-xs leading-relaxed">{data.howItWorks}</p>
              )}
              <dl className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
                <div>
                  <dt className="text-muted-foreground">Algorithm</dt>
                  <dd className="font-mono break-all">{data.algo}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Seed</dt>
                  <dd className="font-mono break-all">{data.drawSeed}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Winner index / tickets</dt>
                  <dd className="font-mono">
                    {data.winnerIndex} / {data.soldCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ledger hash</dt>
                  <dd className="font-mono break-all">{data.ledgerHash}</dd>
                </div>
                {data.memo && (
                  <div>
                    <dt className="text-muted-foreground">Reveal memo</dt>
                    <dd className="font-mono break-all text-xs">{data.memo}</dd>
                  </div>
                )}
              </dl>
              {data.revealTxUrl ? (
                <a
                  href={data.revealTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline"
                >
                  View reveal transaction on Solscan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Reveal transaction not posted yet (seed and index above are still enough to recompute).
                </p>
              )}
              {data.ranges && data.ranges.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Ticket ledger ({data.ranges.length} wallets)
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 font-mono">
                    {data.ranges.map((r) => (
                      <li key={r.wallet}>
                        [{r.startIndex},{r.endIndex}) {shorten(r.wallet)} ×{r.tickets}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

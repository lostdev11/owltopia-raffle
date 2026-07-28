'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Download, ExternalLink, ShieldCheck, Loader2 } from 'lucide-react'

type VerifyRange = {
  wallet: string
  tickets: number
  startIndex: number
  endIndex: number
}

type VerifyPayload = {
  status:
    | 'not_drawn'
    | 'committed'
    | 'vrf_awaiting'
    | 'vrf_pending'
    | 'vrf_failed'
    | 'legacy_draw'
    | 'verified'
    | 'mismatch'
  ok?: boolean
  error?: string | null
  message?: string
  algo?: string
  drawSeed?: string
  drawCommitHash?: string | null
  drawCommittedAt?: string | null
  recomputedCommitHash?: string | null
  soldCount?: number
  winnerIndex?: number
  winnerWallet?: string
  ledgerHash?: string
  ranges?: VerifyRange[]
  memo?: string
  revealTx?: string | null
  revealTxUrl?: string | null
  drawVrfProvider?: string | null
  drawVrfRequestTxUrl?: string | null
  drawVrfFulfillTxUrl?: string | null
  drawVrfError?: string | null
  howItWorks?: string
}

function shorten(s: string, left = 6, right = 4): string {
  if (s.length <= left + right + 1) return s
  return `${s.slice(0, left)}…${s.slice(-right)}`
}

function downloadBlob(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function rangesToCsv(ranges: VerifyRange[]): string {
  const header = 'wallet,tickets,start_index,end_index'
  const rows = ranges.map(
    (r) => `${r.wallet},${r.tickets},${r.startIndex},${r.endIndex}`
  )
  return [header, ...rows].join('\n') + '\n'
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

  const downloadCsv = useCallback(() => {
    if (!data?.ranges?.length) return
    downloadBlob(
      `owltopia-ticket-map-${raffleId}.csv`,
      rangesToCsv(data.ranges),
      'text/csv;charset=utf-8'
    )
  }, [data, raffleId])

  const downloadJson = useCallback(() => {
    if (!data?.ranges?.length) return
    const pack = {
      raffleId,
      algo: data.algo ?? null,
      drawSeed: data.drawSeed ?? null,
      drawCommitHash: data.drawCommitHash ?? null,
      soldCount: data.soldCount ?? null,
      winnerIndex: data.winnerIndex ?? null,
      winnerWallet: data.winnerWallet ?? null,
      ledgerHash: data.ledgerHash ?? null,
      memo: data.memo ?? null,
      revealTx: data.revealTx ?? null,
      ranges: data.ranges,
    }
    downloadBlob(
      `owltopia-ticket-map-${raffleId}.json`,
      `${JSON.stringify(pack, null, 2)}\n`,
      'application/json;charset=utf-8'
    )
  }, [data, raffleId])

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
          {!loading && data?.status === 'committed' && (
            <>
              <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                Draw seed committed — waiting for reveal at draw time.
              </p>
              {data.message && <p className="text-muted-foreground text-xs leading-relaxed">{data.message}</p>}
              {data.howItWorks && (
                <p className="text-muted-foreground text-xs leading-relaxed">{data.howItWorks}</p>
              )}
              <dl className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
                {data.algo && (
                  <div>
                    <dt className="text-muted-foreground">Algorithm</dt>
                    <dd className="font-mono break-all">{data.algo}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Commit hash (SHA-256 of seed)</dt>
                  <dd className="font-mono break-all">{data.drawCommitHash}</dd>
                </div>
                {data.drawCommittedAt && (
                  <div>
                    <dt className="text-muted-foreground">Committed at</dt>
                    <dd className="font-mono break-all">{data.drawCommittedAt}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">
                After the draw, Verify will check that the revealed seed matches this hash.{' '}
                <Link
                  href="/how-it-works#how-draws-work"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  How it works
                </Link>
              </p>
            </>
          )}
          {!loading && data?.status === 'vrf_awaiting' && (
            <>
              <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                VRF draw scheduled — Switchboard randomness at draw time.
              </p>
              {data.message && <p className="text-muted-foreground text-xs leading-relaxed">{data.message}</p>}
              {data.howItWorks && (
                <p className="text-muted-foreground text-xs leading-relaxed">{data.howItWorks}</p>
              )}
              <dl className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
                {data.algo && (
                  <div>
                    <dt className="text-muted-foreground">Algorithm</dt>
                    <dd className="font-mono break-all">{data.algo}</dd>
                  </div>
                )}
                {data.drawVrfProvider && (
                  <div>
                    <dt className="text-muted-foreground">Provider</dt>
                    <dd className="font-mono break-all">{data.drawVrfProvider}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">
                After the draw, Verify will show the seed, ledger, Solscan txs, and ticket map.{' '}
                <Link
                  href="/how-it-works#how-draws-work"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  How it works
                </Link>
              </p>
            </>
          )}
          {!loading && (data?.status === 'vrf_pending' || data?.status === 'vrf_failed') && (
            <>
              <p
                className={
                  data.status === 'vrf_failed'
                    ? 'text-destructive font-medium'
                    : 'text-amber-600 dark:text-amber-400 font-medium'
                }
              >
                {data.status === 'vrf_failed' ? 'VRF draw failed — admin can retry.' : 'VRF draw pending on-chain…'}
              </p>
              {data.message && <p className="text-muted-foreground text-xs leading-relaxed">{data.message}</p>}
              {data.drawVrfError && (
                <p className="text-destructive text-xs font-mono break-all">{data.drawVrfError}</p>
              )}
              {data.howItWorks && (
                <p className="text-muted-foreground text-xs leading-relaxed">{data.howItWorks}</p>
              )}
              {data.drawVrfRequestTxUrl && (
                <a
                  href={data.drawVrfRequestTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[44px] text-primary underline-offset-2 hover:underline touch-manipulation"
                >
                  View VRF request on Solscan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </>
          )}
          {!loading && data?.status === 'legacy_draw' && (
            <>
              <p className="text-muted-foreground">{data.message}</p>
              <p className="text-xs text-muted-foreground">
                How new draws work:{' '}
                <Link
                  href="/how-it-works#how-draws-work"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  How it works → Winner selection
                </Link>
              </p>
            </>
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
              <p className="text-xs text-muted-foreground">
                Full explanation:{' '}
                <Link
                  href="/how-it-works#how-draws-work"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  How it works → Winner selection
                </Link>
              </p>
              <dl className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
                <div>
                  <dt className="text-muted-foreground">Algorithm</dt>
                  <dd className="font-mono break-all">{data.algo}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Seed</dt>
                  <dd className="font-mono break-all">{data.drawSeed}</dd>
                </div>
                {data.drawCommitHash && (
                  <div>
                    <dt className="text-muted-foreground">Commit hash</dt>
                    <dd className="font-mono break-all">{data.drawCommitHash}</dd>
                  </div>
                )}
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
                  className="inline-flex items-center gap-1.5 min-h-[44px] text-primary underline-offset-2 hover:underline touch-manipulation"
                >
                  View reveal transaction on Solscan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Reveal transaction not posted yet (seed and index above are still enough to recompute).
                </p>
              )}
              {data.drawVrfRequestTxUrl && (
                <a
                  href={data.drawVrfRequestTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[44px] text-primary underline-offset-2 hover:underline touch-manipulation"
                >
                  View VRF request on Solscan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {data.drawVrfFulfillTxUrl && (
                <a
                  href={data.drawVrfFulfillTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[44px] text-primary underline-offset-2 hover:underline touch-manipulation"
                >
                  View VRF fulfill on Solscan
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {data.ranges && data.ranges.length > 0 && (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="default"
                      className="w-full sm:w-auto touch-manipulation min-h-[44px]"
                      onClick={downloadCsv}
                    >
                      <Download className="mr-2 h-4 w-4 shrink-0" />
                      Download ticket map (CSV)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="w-full sm:w-auto touch-manipulation min-h-[44px]"
                      onClick={downloadJson}
                    >
                      <Download className="mr-2 h-4 w-4 shrink-0" />
                      Download JSON
                    </Button>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground touch-manipulation min-h-[44px] flex items-center">
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
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

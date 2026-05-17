'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type Row = { display: string; purchased_spots: number; is_you: boolean }

type Props = {
  /** @deprecated Kept for callers; row highlight uses SIWS + server `is_you` only (masked labels). */
  highlightWallet?: string | null
  /** Increment or change after a purchase / refresh so the table reloads from the server. */
  listRefreshKey?: number
  className?: string
}

export function Gen2ParticipantsCard({
  highlightWallet: _highlightWallet,
  listRefreshKey = 0,
  className,
}: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch('/api/gen2-presale/participants?limit=200', {
          cache: 'no-store',
          credentials: 'include',
        })
        const j = (await res.json().catch(() => ({}))) as {
          participants?: Row[]
          error?: string
        }
        if (!res.ok) {
          throw new Error(j.error || 'Could not load participants')
        }
        if (!cancelled) {
          setRows(Array.isArray(j.participants) ? j.participants : [])
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listRefreshKey])

  return (
    <div
      className={cn(
        'rounded-2xl border border-[#00E58B]/25 bg-[#151D24]/95 p-6 shadow-[0_0_40px_rgba(0,0,0,0.35)]',
        className
      )}
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#A9CBB9]">Presale buyers</p>
        <h3 className="text-xl font-bold text-[#EAFBF4]">Spots purchased by wallet</h3>
        <p className="text-sm text-[#A9CBB9]">
          Confirmed presale credits from the server. Labels are masked for privacy. Sign in with Owltopia on this
          browser so your row shows You when it matches your connected wallet.
        </p>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-[#A9CBB9]">Loading…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-amber-200" role="alert">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-[#A9CBB9]">No presale purchases recorded yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl ring-1 ring-[#1F6F54]/50">
          <div
            className={cn(
              'max-h-[min(28rem,52vh)] overflow-auto overscroll-contain touch-manipulation',
              '[scrollbar-gutter:stable]'
            )}
          >
            <table className="w-full min-w-[280px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-[#1F6F54]/60 bg-[#10161C]/95 shadow-[0_1px_0_0_rgba(31,111,84,0.45)] backdrop-blur-sm">
                  <th scope="col" className="px-3 py-3 font-semibold text-[#A9CBB9]">
                    Wallet
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold text-[#A9CBB9]">
                    Spots bought
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isYou = r.is_you === true
                  return (
                    <tr
                      key={`${r.display}-${r.purchased_spots}-${idx}`}
                      className={cn(
                        'border-b border-[#1F6F54]/35 last:border-0',
                        isYou ? 'bg-[#00E58B]/12' : 'bg-transparent'
                      )}
                    >
                      <td className="max-w-[200px] px-3 py-3 font-mono text-xs text-[#EAFBF4] sm:text-sm">
                        <span className="break-all sm:break-normal">{r.display}</span>
                        {isYou && (
                          <span className="ml-2 inline-flex rounded-md border border-[#00FF9C]/40 bg-[#10161C]/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#00FF9C]">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums text-[#00FF9C]">
                        {r.purchased_spots}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

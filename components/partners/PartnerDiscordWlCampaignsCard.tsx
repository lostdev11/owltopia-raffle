'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Download, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const CARD_SURFACE = 'rounded-2xl border border-border/60 bg-card shadow-sm'

type CampaignRow = {
  id: number
  name: string
  phase_key: string
  phase_label: string
  status: string
  channel_id: string
  max_entries: number | null
  spots_per_wallet: number
  wallet_count: number
  launch_id: string | null
  launch_name: string | null
  launch_slug: string | null
  last_pushed_at: string | null
}

export function PartnerDiscordWlCampaignsCard() {
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [pushConfirmId, setPushConfirmId] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/partners/discord-wl-campaigns', { credentials: 'include', cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as { error?: string; campaigns?: CampaignRow[] }
      if (!res.ok) throw new Error(json.error || 'Could not load whitelist spots')
      setRows(json.campaigns ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load whitelist spots')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function downloadCsv(row: CampaignRow) {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/partners/discord-wl-campaigns/${row.id}/export`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || 'Could not download CSV')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition')
      const m = cd?.match(/filename="([^"]+)"/)
      a.download = m?.[1] ?? `wl-${row.id}.csv`
      a.rel = 'noopener'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusyId(null)
    }
  }

  async function copyWallets(row: CampaignRow) {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/partners/discord-wl-campaigns/${row.id}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; wallets?: string[] }
      if (!res.ok) throw new Error(json.error || 'Could not load wallets')
      const text = (json.wallets ?? []).join('\n')
      if (!text) throw new Error('No wallets on this list yet.')
      await navigator.clipboard.writeText(text)
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Copy failed')
    } finally {
      setBusyId(null)
    }
  }

  async function pushToCenter(row: CampaignRow) {
    setBusyId(row.id)
    setError(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/partners/discord-wl-campaigns/${row.id}/push`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; upserted?: number }
      if (!res.ok) throw new Error(json.error || 'Push failed')
      setMsg(`Added ${json.upserted ?? 0} wallet(s) to ${row.phase_label}. Existing Owl Center entries were kept.`)
      setPushConfirmId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card id="wl-campaigns" className={`${CARD_SURFACE} mb-8 scroll-mt-24`}>
      <CardHeader className="border-b border-border/50 pb-4">
        <CardTitle className="text-lg">Whitelist spots</CardTitle>
        <CardDescription>
          Discord collection from <code className="rounded bg-muted/60 px-1 font-mono text-xs">/owltopia-wl</code>{' '}
          or <code className="rounded bg-muted/60 px-1 font-mono text-xs">/query mintlist</code>.
          Members tap Submit wallet — download CSV or push into Owl Center when you close the list.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading whitelist spots…</p>
        ) : !rows || rows.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            No Discord whitelist spots yet. In your partner server run{' '}
            <code className="rounded bg-muted/60 px-1 font-mono text-xs">/owltopia-wl setup</code> then{' '}
            <code className="rounded bg-muted/60 px-1 font-mono text-xs">/owltopia-wl create</code>.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/50">
            {rows.map((r) => {
              const cap = r.max_entries != null ? `${r.wallet_count} / ${r.max_entries}` : `${r.wallet_count} wallets`
              const canPush = Boolean(r.launch_id) && r.wallet_count > 0
              return (
                <li key={r.id} className="flex flex-col gap-3 bg-card/40 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {r.name}{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        ({r.phase_label} · {r.status} · {cap})
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.launch_name ? `Collection: ${r.launch_name}` : 'Not linked to Owl Center yet'}
                      {r.last_pushed_at ? ` · Last push ${new Date(r.last_pushed_at).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] touch-manipulation"
                      disabled={busyId === r.id || r.wallet_count < 1}
                      onClick={() => void downloadCsv(r)}
                    >
                      {busyId === r.id ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                      <span className="ml-2">Download CSV</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] touch-manipulation"
                      disabled={busyId === r.id || r.wallet_count < 1}
                      onClick={() => void copyWallets(r)}
                    >
                      {copiedId === r.id ? (
                        <Check className="h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <Copy className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                      <span className="ml-2">{copiedId === r.id ? 'Copied' : 'Copy wallets'}</span>
                    </Button>
                    {pushConfirmId === r.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-[44px] touch-manipulation"
                          disabled={busyId === r.id}
                          onClick={() => void pushToCenter(r)}
                        >
                          {busyId === r.id ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                          ) : (
                            <Upload className="h-4 w-4 shrink-0" aria-hidden />
                          )}
                          <span className="ml-2">Add {r.wallet_count} to {r.phase_label}?</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px] touch-manipulation"
                          disabled={busyId === r.id}
                          onClick={() => setPushConfirmId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] touch-manipulation"
                        disabled={!canPush || busyId === r.id}
                        onClick={() => setPushConfirmId(r.id)}
                      >
                        <Upload className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="ml-2">Push to Owl Center</span>
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        {msg ? <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p> : null}
      </CardContent>
    </Card>
  )
}

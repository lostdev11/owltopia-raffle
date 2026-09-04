'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Loader2, ArrowLeft, Library, ExternalLink } from 'lucide-react'
import type { PlatformProjectAdminRow, PlatformProjectOutreachStatus } from '@/lib/db/platform-projects'

const OUTREACH_OPTIONS: { value: PlatformProjectOutreachStatus; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'skip', label: 'Skip' },
]

function truncateMint(mint: string): string {
  const t = mint.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

function formatWhen(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return '—'
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminProjectsPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [rows, setRows] = useState<PlatformProjectAdminRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [createMint, setCreateMint] = useState('')
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [expandedMint, setExpandedMint] = useState<string | null>(null)
  const [savingMint, setSavingMint] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<
    Record<string, { notes: string; outreach_status: PlatformProjectOutreachStatus; tags: string; twitter_handle: string }>
  >({})

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/platform-projects', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.projects)) {
        const projects = data.projects as PlatformProjectAdminRow[]
        setRows(projects)
        setDrafts(
          Object.fromEntries(
            projects.map((p) => [
              p.collection_mint,
              {
                notes: p.notes ?? '',
                outreach_status: p.outreach_status,
                tags: p.tags.join(', '),
                twitter_handle: p.twitter_handle ?? '',
              },
            ])
          )
        )
      } else {
        setListError(typeof data.error === 'string' ? data.error : 'Could not load projects')
      }
    } catch {
      setListError('Could not load projects')
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchList()
  }, [isAdmin, fetchList])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((p) => {
      return (
        p.display_name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.collection_mint.toLowerCase().includes(q) ||
        (p.twitter_handle || '').toLowerCase().includes(q) ||
        p.outreach_status.includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [rows, query])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/admin/platform-projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_mint: createMint.trim(),
          display_name: createName.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Could not add project')
        return
      }
      setCreateMint('')
      setCreateName('')
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  const saveRow = async (mint: string) => {
    const draft = drafts[mint]
    if (!draft) return
    setSavingMint(mint)
    try {
      const res = await fetch(`/api/admin/platform-projects/${encodeURIComponent(mint)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: draft.notes.trim() || null,
          outreach_status: draft.outreach_status,
          tags: draft.tags,
          twitter_handle: draft.twitter_handle.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.project) {
        setRows((prev) =>
          prev.map((p) => (p.collection_mint === mint ? { ...p, ...data.project, partner_host: p.partner_host } : p))
        )
      }
    } finally {
      setSavingMint(null)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Connect a wallet to open Owl Vision.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking admin…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Full Owl Vision access is required.</p>
        <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
          <Link href="/admin">Back to Owl Vision</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] mb-6">
        <Link href="/admin">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Owl Vision
        </Link>
      </Button>

      <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
        <Library className="h-7 w-7 shrink-0 text-emerald-400" aria-hidden />
        Project index
      </h1>
      <p className="text-muted-foreground text-sm mb-8">
        Collections that have raffled on the platform (keyed by on-chain collection mint). This is a snapshot +
        outreach CRM — it does <strong className="text-foreground">not</strong> change partner fees or the Partner tab.
        Filter live raffles with{' '}
        <Link href="/raffles" className="text-primary underline-offset-4 hover:underline">
          /raffles?collection=
        </Link>
        . Run <span className="font-mono text-xs">npx tsx scripts/backfill-platform-projects.ts</span> to snapshot
        historical listings.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Add by collection mint</CardTitle>
          <CardDescription>
            Use this for collections you want on the list before they raffle again. DAS fills the name when possible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-3">
            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
            <div className="space-y-2">
              <Label htmlFor="collection_mint">Collection mint</Label>
              <Input
                id="collection_mint"
                className="font-mono text-sm touch-manipulation min-h-[44px]"
                placeholder="Solana collection address"
                value={createMint}
                onChange={(e) => setCreateMint(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name (optional)</Label>
              <Input
                id="display_name"
                className="touch-manipulation min-h-[44px]"
                placeholder="If DAS has no name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={creating} className="min-h-[44px] touch-manipulation">
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add project
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mb-4">
        <Label htmlFor="project-search" className="sr-only">
          Search projects
        </Label>
        <Input
          id="project-search"
          type="search"
          placeholder="Search name, mint, tag, status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-[44px] touch-manipulation"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {filtered.length} of {rows.length} projects
        </p>
      </div>

      {listError ? <p className="text-sm text-destructive mb-4">{listError}</p> : null}
      {loadingList ? (
        <p className="text-muted-foreground flex items-center gap-2 min-h-[44px]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading projects…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet. Create an NFT raffle or run the backfill.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((p) => {
            const open = expandedMint === p.collection_mint
            const draft = drafts[p.collection_mint]
            return (
              <li key={p.collection_mint}>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="text-base sm:text-lg flex flex-wrap items-center gap-2">
                          {p.display_name}
                          {p.partner_host ? (
                            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
                              Partner host
                            </span>
                          ) : null}
                          {p.outreach_status !== 'none' ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                              {p.outreach_status}
                            </span>
                          ) : null}
                        </CardTitle>
                        <CardDescription className="font-mono text-xs break-all mt-1">
                          {p.collection_mint}
                        </CardDescription>
                        <p className="text-xs text-muted-foreground mt-2">
                          {p.raffle_count} raffle{p.raffle_count === 1 ? '' : 's'} · last {formatWhen(p.last_seen_at)}
                          {p.last_host_wallet ? ` · host ${truncateMint(p.last_host_wallet)}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <Button asChild variant="outline" size="sm" className="min-h-[44px] touch-manipulation">
                          <Link href={`/raffles?collection=${encodeURIComponent(p.collection_mint)}`}>
                            Raffles
                            <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="min-h-[44px] touch-manipulation"
                          onClick={() => setExpandedMint(open ? null : p.collection_mint)}
                        >
                          {open ? 'Hide CRM' : 'Notes'}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {open && draft ? (
                    <CardContent className="space-y-3 border-t pt-4">
                      <div className="space-y-2">
                        <Label htmlFor={`status-${p.collection_mint}`}>Outreach</Label>
                        <select
                          id={`status-${p.collection_mint}`}
                          className="flex min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                          value={draft.outreach_status}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [p.collection_mint]: {
                                ...draft,
                                outreach_status: e.target.value as PlatformProjectOutreachStatus,
                              },
                            }))
                          }
                        >
                          {OUTREACH_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`x-${p.collection_mint}`}>X handle</Label>
                        <Input
                          id={`x-${p.collection_mint}`}
                          className="min-h-[44px] touch-manipulation"
                          placeholder="without @"
                          value={draft.twitter_handle}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [p.collection_mint]: { ...draft, twitter_handle: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`tags-${p.collection_mint}`}>Tags (comma separated)</Label>
                        <Input
                          id={`tags-${p.collection_mint}`}
                          className="min-h-[44px] touch-manipulation"
                          value={draft.tags}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [p.collection_mint]: { ...draft, tags: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${p.collection_mint}`}>Notes</Label>
                        <textarea
                          id={`notes-${p.collection_mint}`}
                          rows={4}
                          className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm touch-manipulation"
                          value={draft.notes}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [p.collection_mint]: { ...draft, notes: e.target.value },
                            }))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => void saveRow(p.collection_mint)}
                        disabled={savingMint === p.collection_mint}
                        className="min-h-[44px] touch-manipulation"
                      >
                        {savingMint === p.collection_mint ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : null}
                        Save
                      </Button>
                    </CardContent>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

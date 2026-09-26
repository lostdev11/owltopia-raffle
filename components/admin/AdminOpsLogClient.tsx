'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import {
  getCachedAdmin,
  getCachedAdminRole,
  setCachedAdmin,
  type AdminRole,
} from '@/lib/admin-check-cache'
import { parseAdminRole } from '@/lib/admin/roles'
import {
  ADMIN_OPS_LOG_ASSETS,
  ADMIN_OPS_LOG_STATUSES,
  ADMIN_OPS_LOG_TYPES,
  type AdminOpsLogRow,
  type AdminOpsLogStatus,
  type AdminOpsLogType,
} from '@/lib/db/admin-ops-log'
import { solscanAccountUrl, solscanTransactionUrl } from '@/lib/solana/solscan'
import { ArrowLeft, ClipboardList, Download, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'

const TYPE_LABELS: Record<AdminOpsLogType, string> = {
  refund: 'Refund',
  prize_payout: 'Prize payout',
  top_up: 'Top-up',
  mis_send: 'Mis-send',
  incident: 'Incident',
  fee_refund: 'Fee refund',
  other: 'Other',
}

const STATUS_LABELS: Record<AdminOpsLogStatus, string> = {
  pending: 'Pending',
  done: 'Done',
  lost: 'Lost',
  needs_decision: 'Needs decision',
}

function formatWhen(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return '—'
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function localDatetimeToIso(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function truncateMiddle(value: string, max = 14): string {
  const t = value.trim()
  if (t.length <= max) return t
  return `${t.slice(0, 6)}…${t.slice(-4)}`
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function rowsToCsv(rows: AdminOpsLogRow[]): string {
  const headers = [
    'occurred_at',
    'type',
    'title',
    'who',
    'wallet',
    'amount',
    'asset',
    'from_wallet',
    'tx_signature',
    'related',
    'status',
    'notes',
    'created_by_wallet',
    'updated_by_wallet',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.occurred_at,
        r.type,
        r.title,
        r.who ?? '',
        r.wallet ?? '',
        r.amount != null ? String(r.amount) : '',
        r.asset ?? '',
        r.from_wallet ?? '',
        r.tx_signature ?? '',
        r.related ?? '',
        r.status,
        r.notes ?? '',
        r.created_by_wallet,
        r.updated_by_wallet ?? '',
      ]
        .map((c) => csvEscape(String(c)))
        .join(',')
    )
  }
  return lines.join('\n')
}

const emptyForm = {
  occurred_at: '',
  type: 'incident' as AdminOpsLogType,
  title: '',
  who: '',
  wallet: '',
  amount: '',
  asset: '' as AdminOpsLogAsset | '',
  from_wallet: '',
  tx_signature: '',
  related: '',
  status: 'pending' as AdminOpsLogStatus,
  notes: '',
}

type AdminOpsLogAsset = (typeof ADMIN_OPS_LOG_ASSETS)[number]

export function AdminOpsLogClient() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() => cachedRole)
  const [loading, setLoading] = useState(() => !cachedTrue)
  const isFullAdmin = adminRole === 'full'
  const canUseOpsLog = adminRole === 'mod' || adminRole === 'full'

  const [entries, setEntries] = useState<AdminOpsLogRow[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<AdminOpsLogType | ''>('')
  const [filterStatus, setFilterStatus] = useState<AdminOpsLogStatus | ''>('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setOffset(0)
  }, [filterType, filterStatus, searchDebounced])

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setAdminRole(null)
      setLoading(false)
      return
    }
    const addr = publicKey.toBase58()
    if (getCachedAdmin(addr) === true) {
      setIsAdmin(true)
      setAdminRole(getCachedAdminRole(addr))
      setLoading(false)
      return
    }
    setLoading(true)
    let cancelled = false
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { credentials: 'include' })
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin ? parseAdminRole(data?.role) : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false)
          setAdminRole(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey])

  const fetchList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      if (filterType) params.set('type', filterType)
      if (filterStatus) params.set('status', filterStatus)
      if (searchDebounced) params.set('search', searchDebounced)
      const res = await fetch(`/api/admin/ops-log?${params.toString()}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.entries)) {
        setEntries(data.entries as AdminOpsLogRow[])
        setTotal(typeof data.total === 'number' ? data.total : data.entries.length)
      } else {
        setListError(typeof data.error === 'string' ? data.error : 'Could not load ops log')
      }
    } catch {
      setListError('Could not load ops log')
    } finally {
      setListLoading(false)
    }
  }, [filterType, filterStatus, searchDebounced, offset])

  useEffect(() => {
    if (!isAdmin || !canUseOpsLog) return
    void fetchList()
  }, [isAdmin, canUseOpsLog, fetchList])

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])
  const pageIndex = Math.floor(offset / limit) + 1

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    if (!form.title.trim()) {
      setCreateError('Title is required')
      return
    }
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        type: form.type,
        title: form.title.trim(),
        status: form.status,
        who: form.who.trim() || null,
        wallet: form.wallet.trim() || null,
        from_wallet: form.from_wallet.trim() || null,
        tx_signature: form.tx_signature.trim() || null,
        related: form.related.trim() || null,
        notes: form.notes.trim() || null,
        asset: form.asset || null,
      }
      const occurred = localDatetimeToIso(form.occurred_at)
      if (occurred) body.occurred_at = occurred
      if (form.amount.trim()) {
        const n = Number(form.amount)
        if (!Number.isFinite(n)) {
          setCreateError('Invalid amount')
          return
        }
        body.amount = n
      }
      const res = await fetch('/api/admin/ops-log', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Create failed')
        return
      }
      setForm(emptyForm)
      setShowForm(false)
      setOffset(0)
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  async function handleStatusChange(id: string, status: AdminOpsLogStatus) {
    setStatusSavingId(id)
    try {
      const res = await fetch(`/api/admin/ops-log/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.entry) {
          setEntries((prev) => prev.map((row) => (row.id === id ? (data.entry as AdminOpsLogRow) : row)))
        } else {
          await fetchList()
        }
      }
    } finally {
      setStatusSavingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!isFullAdmin) return
    if (!window.confirm('Delete this ops log entry permanently?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/ops-log/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setEntries((prev) => prev.filter((r) => r.id !== id))
        setTotal((t) => Math.max(0, t - 1))
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleExportCsv() {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '2000')
      params.set('offset', '0')
      if (filterType) params.set('type', filterType)
      if (filterStatus) params.set('status', filterStatus)
      if (searchDebounced) params.set('search', searchDebounced)
      const res = await fetch(`/api/admin/ops-log?${params.toString()}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data.entries)) return
      const csv = rowsToCsv(data.entries as AdminOpsLogRow[])
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ops-log-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!connected || !isAdmin) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Ops Log</CardTitle>
            <CardDescription>Connect an Owl Vision admin wallet to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!canUseOpsLog) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Ops Log</CardTitle>
            <CardDescription>
              Your wallet is not on the admin list, or your role cannot access this tool.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="touch-manipulation min-h-[44px]">
          <Link href="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Owl Vision
          </Link>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Ops Log
          </CardTitle>
          <CardDescription>
            Track manual money moves and incidents — refunds sent by hand, prize payouts, wallet top-ups,
            mis-sends, stuck buyers, and fee refunds. Junior mods can view, add, and update status; only full
            admins can delete entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[140px] flex-1">
              <Label htmlFor="ops-filter-type">Type</Label>
              <select
                id="ops-filter-type"
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as AdminOpsLogType | '')}
              >
                <option value="">All types</option>
                {ADMIN_OPS_LOG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px] flex-1">
              <Label htmlFor="ops-filter-status">Status</Label>
              <select
                id="ops-filter-status"
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as AdminOpsLogStatus | '')}
              >
                <option value="">All statuses</option>
                {ADMIN_OPS_LOG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[180px] flex-[2]">
              <Label htmlFor="ops-search">Search</Label>
              <Input
                id="ops-search"
                className="mt-1"
                placeholder="Title, wallet, tx, notes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="touch-manipulation min-h-[44px]"
              onClick={() => setShowForm((v) => !v)}
            >
              <Plus className="mr-2 h-4 w-4" />
              {showForm ? 'Hide form' : 'Add entry'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="touch-manipulation min-h-[44px]"
              disabled={exporting || listLoading}
              onClick={() => void handleExportCsv()}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export CSV
            </Button>
          </div>

          {showForm && (
            <form onSubmit={(e) => void handleCreate(e)} className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">New entry</p>
              {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="ops-form-occurred">When (local)</Label>
                  <Input
                    id="ops-form-occurred"
                    type="datetime-local"
                    value={form.occurred_at}
                    onChange={(e) => setForm((f) => ({ ...f, occurred_at: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-type">Type</Label>
                  <select
                    id="ops-form-type"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AdminOpsLogType }))}
                  >
                    {ADMIN_OPS_LOG_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="ops-form-title">Title</Label>
                  <Input
                    id="ops-form-title"
                    required
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-who">Who (Discord / name)</Label>
                  <Input
                    id="ops-form-who"
                    value={form.who}
                    onChange={(e) => setForm((f) => ({ ...f, who: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-wallet">Wallet</Label>
                  <Input
                    id="ops-form-wallet"
                    value={form.wallet}
                    onChange={(e) => setForm((f) => ({ ...f, wallet: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-amount">Amount</Label>
                  <Input
                    id="ops-form-amount"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-asset">Asset</Label>
                  <select
                    id="ops-form-asset"
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.asset}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, asset: e.target.value as AdminOpsLogAsset | '' }))
                    }
                  >
                    <option value="">—</option>
                    {ADMIN_OPS_LOG_ASSETS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="ops-form-from">From wallet</Label>
                  <Input
                    id="ops-form-from"
                    value={form.from_wallet}
                    onChange={(e) => setForm((f) => ({ ...f, from_wallet: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="ops-form-tx">Tx signature</Label>
                  <Input
                    id="ops-form-tx"
                    value={form.tx_signature}
                    onChange={(e) => setForm((f) => ({ ...f, tx_signature: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="ops-form-related">Related (pack open id, raffle, PR…)</Label>
                  <Input
                    id="ops-form-related"
                    value={form.related}
                    onChange={(e) => setForm((f) => ({ ...f, related: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="ops-form-notes">Notes</Label>
                  <Input
                    id="ops-form-notes"
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="submit" disabled={creating} className="touch-manipulation min-h-[44px]">
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save entry
              </Button>
            </form>
          )}

          {listError ? <p className="text-sm text-destructive">{listError}</p> : null}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2 font-medium">When</th>
                  <th className="p-2 font-medium">Type</th>
                  <th className="p-2 font-medium">Title</th>
                  <th className="p-2 font-medium">Amount</th>
                  <th className="p-2 font-medium">Wallet / tx</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium w-[72px]" />
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      No entries yet.
                    </td>
                  </tr>
                ) : (
                  entries.map((row) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="p-2 whitespace-nowrap">{formatWhen(row.occurred_at)}</td>
                      <td className="p-2 whitespace-nowrap">{TYPE_LABELS[row.type]}</td>
                      <td className="p-2 max-w-[200px]">
                        <div className="font-medium">{row.title}</div>
                        {row.who ? <div className="text-xs text-muted-foreground">{row.who}</div> : null}
                        {row.related ? (
                          <div className="text-xs text-muted-foreground truncate" title={row.related}>
                            {row.related}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {row.amount != null ? (
                          <>
                            {row.amount} {row.asset ?? ''}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2 space-y-1">
                        {row.wallet ? (
                          <a
                            href={solscanAccountUrl(row.wallet)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {truncateMiddle(row.wallet)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        {row.tx_signature ? (
                          <a
                            href={solscanTransactionUrl(row.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                          >
                            tx {truncateMiddle(row.tx_signature, 12)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                          value={row.status}
                          disabled={statusSavingId === row.id}
                          onChange={(e) =>
                            void handleStatusChange(row.id, e.target.value as AdminOpsLogStatus)
                          }
                        >
                          {ADMIN_OPS_LOG_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        {isFullAdmin ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            disabled={deletingId === row.id}
                            onClick={() => void handleDelete(row.id)}
                            title="Delete (full admin)"
                          >
                            {deletingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {total > limit ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {pageIndex} of {pageCount} ({total} entries)
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset <= 0 || listLoading}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={offset + limit >= total || listLoading}
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getCachedAdmin,
  getCachedAdminRole,
  setCachedAdmin,
  type AdminRole,
} from '@/lib/admin-check-cache'
import { parseAdminRole } from '@/lib/admin/roles'
import {
  ADMIN_PACK_OPEN_STATUSES,
  ADMIN_PACK_OPEN_STATUS_LABELS,
} from '@/lib/admin-pack-opens/constants'
import type { AdminPackOpenDetailRow, AdminPackOpenListRow } from '@/lib/admin-pack-opens/types'
import type { PackOpenStatus } from '@/lib/packs/types'
import { solscanAccountUrl, solscanTransactionUrl } from '@/lib/solana/solscan'
import { ArrowLeft, ChevronDown, ChevronRight, ClipboardList, Copy, ExternalLink, Loader2, Package } from 'lucide-react'

function formatWhen(iso: string): string {
  const d = Date.parse(iso)
  if (!Number.isFinite(d)) return '—'
  return new Date(d).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function truncateMiddle(value: string, max = 14): string {
  const t = value.trim()
  if (t.length <= max) return t
  return `${t.slice(0, 6)}…${t.slice(-4)}`
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* ignore */
  }
}

function statusBadgeClass(status: PackOpenStatus): string {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (status === 'refund_needed' || status === 'failed') {
    return 'bg-red-500/15 text-red-200 border-red-500/30'
  }
  if (status === 'pending_payment') return 'bg-white/10 text-white/70 border-white/20'
  return 'bg-amber-500/15 text-amber-100 border-amber-500/30'
}

function TxLink({ sig, label }: { sig: string | null; label: string }) {
  if (!sig?.trim()) return <span className="text-white/40">—</span>
  return (
    <a
      href={solscanTransactionUrl(sig)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-sky-300 hover:underline"
      title={sig}
    >
      {truncateMiddle(sig, 18)}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      <span className="sr-only">{label}</span>
    </a>
  )
}

export function AdminPackOpensClient() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<AdminRole | null>(() => cachedRole)
  const [loading, setLoading] = useState(() => !cachedTrue)
  const canView = adminRole === 'mod' || adminRole === 'full'
  const isFullAdmin = adminRole === 'full'

  const [products, setProducts] = useState<{ id: string; slug: string; name: string }[]>([])
  const [opens, setOpens] = useState<AdminPackOpenListRow[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [filterWallet, setFilterWallet] = useState('')
  const [walletPrefix, setWalletPrefix] = useState(false)
  const [selectedStatuses, setSelectedStatuses] = useState<Set<PackOpenStatus>>(new Set())
  const [filterProductId, setFilterProductId] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [stuckOnly, setStuckOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const limit = 50

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminPackOpenDetailRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

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

  useEffect(() => {
    if (!canView) return
    void fetch('/api/admin/pack-opens?meta=products', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.products)) setProducts(data.products)
      })
      .catch(() => {})
  }, [canView])

  useEffect(() => {
    setOffset(0)
  }, [filterWallet, walletPrefix, filterProductId, createdFrom, createdTo, stuckOnly, selectedStatuses])

  const statusQuery = useMemo(() => {
    if (selectedStatuses.size === 0) return ''
    return Array.from(selectedStatuses).join(',')
  }, [selectedStatuses])

  const fetchList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      const w = filterWallet.trim()
      if (w) {
        params.set('wallet', w)
        if (walletPrefix) params.set('wallet_mode', 'prefix')
      }
      if (statusQuery) params.set('status', statusQuery)
      if (filterProductId) params.set('product_id', filterProductId)
      if (createdFrom) {
        const iso = new Date(createdFrom).toISOString()
        if (Number.isFinite(Date.parse(iso))) params.set('created_from', iso)
      }
      if (createdTo) {
        const iso = new Date(createdTo).toISOString()
        if (Number.isFinite(Date.parse(iso))) params.set('created_to', iso)
      }
      if (stuckOnly) params.set('stuck', '1')

      const res = await fetch(`/api/admin/pack-opens?${params.toString()}`, { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.opens)) {
        setOpens(data.opens as AdminPackOpenListRow[])
        setTotal(typeof data.total === 'number' ? data.total : data.opens.length)
      } else {
        setListError(typeof data.error === 'string' ? data.error : 'Could not load pack opens')
      }
    } catch {
      setListError('Could not load pack opens')
    } finally {
      setListLoading(false)
    }
  }, [
    offset,
    filterWallet,
    walletPrefix,
    statusQuery,
    filterProductId,
    createdFrom,
    createdTo,
    stuckOnly,
  ])

  useEffect(() => {
    if (!isAdmin || !canView) return
    void fetchList()
  }, [isAdmin, canView, fetchList])

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit])
  const pageIndex = Math.floor(offset / limit) + 1

  function toggleStatus(status: PackOpenStatus) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  async function openDetail(id: string) {
    setExpandedId(id)
    setDialogOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      const res = await fetch(`/api/admin/pack-opens?id=${encodeURIComponent(id)}`, {
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.open) setDetail(data.open as AdminPackOpenDetailRow)
    } finally {
      setDetailLoading(false)
    }
  }

  function opsLogPrefillHref(row: AdminPackOpenListRow): string {
    const params = new URLSearchParams()
    params.set('prefill_wallet', row.buyer_wallet)
    params.set('prefill_related', row.id)
    params.set('prefill_title', `Pack open ${row.id.slice(0, 8)}…`)
    return `/admin/ops-log?${params.toString()}`
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!connected || !isAdmin) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Pack opens</CardTitle>
            <CardDescription>Connect an Owl Vision admin wallet to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Pack opens</CardTitle>
            <CardDescription>Your role cannot access this tool.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-[1400px] px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="touch-manipulation min-h-[44px]">
          <Link href="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Owl Vision
          </Link>
        </Button>
        {isFullAdmin && (
          <Button variant="outline" size="sm" asChild className="touch-manipulation min-h-[44px]">
            <Link href="/admin/packs">
              <Package className="mr-2 h-4 w-4" />
              Packs admin (resolve)
            </Link>
          </Button>
        )}
      </div>

      <Card className="mb-6 border-white/10 bg-black/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pack opens
          </CardTitle>
          <CardDescription>
            Database view of pack open transactions (newest first). Read-only for junior admins — use Ops Log for
            manual refunds and payouts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="po-filter-wallet" className="text-xs">
                Buyer wallet
              </Label>
              <Input
                id="po-filter-wallet"
                value={filterWallet}
                onChange={(e) => setFilterWallet(e.target.value)}
                placeholder="Exact or prefix"
                className="mt-1 font-mono text-xs"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={walletPrefix}
                  onChange={(e) => setWalletPrefix(e.target.checked)}
                />
                Prefix match
              </label>
            </div>
            <div>
              <Label htmlFor="po-filter-product" className="text-xs">
                Product
              </Label>
              <select
                id="po-filter-product"
                value={filterProductId}
                onChange={(e) => setFilterProductId(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="po-from" className="text-xs">
                Created from (local)
              </Label>
              <Input
                id="po-from"
                type="datetime-local"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>
            <div>
              <Label htmlFor="po-to" className="text-xs">
                Created to (local)
              </Label>
              <Input
                id="po-to"
                type="datetime-local"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Status (multi-select)</p>
            <div className="flex flex-wrap gap-2">
              {ADMIN_PACK_OPEN_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    selectedStatuses.has(s)
                      ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                      : 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  {ADMIN_PACK_OPEN_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={stuckOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStuckOnly((v) => !v)}
            >
              Stuck / needs attention
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void fetchList()}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {listError && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm text-red-200">
          {listError}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-white/10 bg-white/5 text-xs uppercase tracking-wide text-white/50">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Buyer</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Payment tx</th>
              <th className="px-3 py-2">Payout / VRF</th>
              <th className="px-3 py-2">Prize</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {listLoading ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : opens.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
                  No pack opens match filters.
                </td>
              </tr>
            ) : (
              opens.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{formatWhen(row.created_at)}</td>
                    <td className="px-3 py-2">
                      <a
                        href={solscanAccountUrl(row.buyer_wallet)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-sky-300 hover:underline"
                        title={row.buyer_wallet}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {truncateMiddle(row.buyer_wallet)}
                      </a>
                      <button
                        type="button"
                        className="ml-1 inline-flex text-white/40 hover:text-white/80"
                        title="Copy wallet"
                        onClick={() => void copyText(row.buyer_wallet)}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.product.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {row.price_display}
                      <span className="ml-1 text-white/40">({row.payment_currency})</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(row.status)}`}
                      >
                        {ADMIN_PACK_OPEN_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <TxLink sig={row.payment_signature} label="Payment" />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Payout: <TxLink sig={row.payout_signature} label="Payout" /></div>
                      {row.open_vrf_fulfill_tx ? (
                        <div className="mt-0.5 text-white/50">
                          VRF: <TxLink sig={row.open_vrf_fulfill_tx} label="VRF fulfill" />
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-xs" title={row.prize_summary ?? ''}>
                      {row.prize_summary ?? '—'}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-xs text-red-200/90" title={row.error_message ?? row.open_vrf_error ?? ''}>
                      {row.error_message ?? row.open_vrf_error ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-white/60">
                      {formatWhen(row.last_activity_at)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-mono text-xs text-white/70 hover:text-white"
                        title={row.id}
                        onClick={() => void copyText(row.id)}
                      >
                        {row.id.slice(0, 8)}…
                        <Copy className="ml-1 inline h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => void openDetail(row.id)}>
                          {expandedId === row.id && dialogOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          Detail
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2" asChild>
                          <Link href={opsLogPrefillHref(row)}>
                            <ClipboardList className="mr-1 h-3 w-3" />
                            Ops Log
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {pageIndex} of {pageCount} · {total} total
        </p>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pack open detail</DialogTitle>
            <DialogDescription>Non-secret fields from pack_opens (no open_seed).</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          ) : detail ? (
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['ID', detail.id],
                  ['Status', ADMIN_PACK_OPEN_STATUS_LABELS[detail.status]],
                  ['Buyer', detail.buyer_wallet],
                  ['Product', `${detail.product.name} (${detail.product.slug})`],
                  ['Payment currency', detail.payment_currency],
                  ['Price', detail.price_display],
                  ['Created', formatWhen(detail.created_at)],
                  ['Completed', detail.completed_at ? formatWhen(detail.completed_at) : '—'],
                  ['Last activity', formatWhen(detail.last_activity_at)],
                  ['Open algo', detail.open_algo],
                  ['Commit hash', detail.open_commit_hash ?? '—'],
                  ['Category', detail.category ?? '—'],
                  ['Prize label', detail.prize_label ?? '—'],
                  ['OWL amount', detail.owl_amount ?? '—'],
                  ['SOL amount', detail.sol_amount ?? '—'],
                  ['NFT mint', detail.nft_mint_address ?? '—'],
                  ['Fair value SOL', detail.fair_value_sol ?? '—'],
                  ['Free ticket credits', detail.free_ticket_credits],
                  ['Jackpot win', detail.is_jackpot_win ? 'yes' : 'no'],
                  ['Jackpot amount SOL', detail.jackpot_amount_sol ?? '—'],
                  ['Payment signature', detail.payment_signature ?? '—'],
                  ['Payout signature', detail.payout_signature ?? '—'],
                  ['VRF provider', detail.open_vrf_provider ?? '—'],
                  ['VRF status', detail.open_vrf_status ?? '—'],
                  ['VRF account', detail.open_vrf_account ?? '—'],
                  ['VRF request tx', detail.open_vrf_request_tx ?? '—'],
                  ['VRF fulfill tx', detail.open_vrf_fulfill_tx ?? '—'],
                  ['VRF error', detail.open_vrf_error ?? '—'],
                  ['Error message', detail.error_message ?? '—'],
                  ['NFT pool snapshot rows', detail.nft_pool_snapshot_count ?? '—'],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[140px_1fr] gap-2 border-b border-white/5 py-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all font-mono text-xs">{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load detail.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

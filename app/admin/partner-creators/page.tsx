'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import { Loader2, ArrowLeft, HeartHandshake, Trash2 } from 'lucide-react'
import type { PartnerCommunityCreatorRow } from '@/lib/db/partner-community-creators-admin'

type PartnerCreatorAdminRow = PartnerCommunityCreatorRow & { profile_display_name: string | null }

export default function AdminPartnerCreatorsPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [rows, setRows] = useState<PartnerCreatorAdminRow[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingWallet, setDeletingWallet] = useState<string | null>(null)
  const [savingWallet, setSavingWallet] = useState<string | null>(null)

  const [form, setForm] = useState({
    creator_wallet: '',
    display_label: '',
    sort_order: '0',
    is_active: true,
  })

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
    try {
      const res = await fetch('/api/admin/partner-community-creators', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.creators)) {
        setRows(data.creators)
      } else {
        setRows([])
      }
    } catch {
      setRows([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void fetchList()
  }, [isAdmin, fetchList])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const sortParsed = parseInt(String(form.sort_order).trim(), 10)
      const res = await fetch('/api/admin/partner-community-creators', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creator_wallet: form.creator_wallet.trim(),
          display_label: form.display_label.trim() || null,
          sort_order: Number.isFinite(sortParsed) ? sortParsed : 0,
          is_active: form.is_active,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCreateError(typeof data.error === 'string' ? data.error : 'Could not add partner wallet')
        return
      }
      setForm({ creator_wallet: '', display_label: '', sort_order: '0', is_active: true })
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  const patchRow = async (creator_wallet: string, body: Record<string, unknown>) => {
    setSavingWallet(creator_wallet)
    try {
      const enc = encodeURIComponent(creator_wallet)
      const res = await fetch(`/api/admin/partner-community-creators/${enc}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) await fetchList()
    } finally {
      setSavingWallet(null)
    }
  }

  const deleteRow = async (creator_wallet: string) => {
    if (!window.confirm(`Remove partner wallet from the list?\n\n${creator_wallet}`)) return
    setDeletingWallet(creator_wallet)
    try {
      const enc = encodeURIComponent(creator_wallet)
      const res = await fetch(`/api/admin/partner-community-creators/${enc}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) await fetchList()
    } finally {
      setDeletingWallet(null)
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto max-w-lg py-12 px-4 text-center">
        <p className="text-muted-foreground mb-6">Connect a full-admin wallet to manage partner creators.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto py-12 px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" />
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
        <HeartHandshake className="h-7 w-7 shrink-0 text-violet-400" aria-hidden />
        Partner program creators
      </h1>
      <p className="text-muted-foreground text-sm mb-8">
        Wallets here get the <strong className="text-foreground">2%</strong> partner fee tier and appear in the partner
        spotlight on <Link href="/raffles?tab=partner-raffles" className="text-primary underline-offset-4 hover:underline">Raffles</Link>.
        On raffle cards we show the creator&apos;s <strong className="text-foreground">dashboard display name</strong>{' '}
        from <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">wallet profile</Link> when
        set; otherwise the optional allowlist label below. Public site reads active rows only; you can deactivate without
        deleting. Changes apply within about a minute of cache expiry, or immediately after each save from this page.
      </p>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">Add partner wallet</CardTitle>
          <CardDescription>
            Validates as a Solana address. Duplicate wallets return an error. Partners should save a display name on
            their dashboard so listings show a friendly name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="space-y-2">
              <Label htmlFor="creator_wallet">Creator wallet</Label>
              <Input
                id="creator_wallet"
                name="creator_wallet"
                className="font-mono text-sm touch-manipulation min-h-[44px]"
                placeholder="Solana public key"
                value={form.creator_wallet}
                onChange={(e) => setForm((f) => ({ ...f, creator_wallet: e.target.value }))}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display_label">Allowlist label (optional fallback)</Label>
              <Input
                id="display_label"
                name="display_label"
                className="touch-manipulation min-h-[44px]"
                placeholder="Only if they have no dashboard display name"
                value={form.display_label}
                onChange={(e) => setForm((f) => ({ ...f, display_label: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="space-y-2 sm:max-w-[140px]">
                <Label htmlFor="sort_order">Sort order</Label>
                <Input
                  id="sort_order"
                  name="sort_order"
                  inputMode="numeric"
                  className="touch-manipulation min-h-[44px]"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 min-h-[44px] touch-manipulation cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
            <Button type="submit" disabled={creating} className="min-h-[44px] w-full sm:w-auto touch-manipulation">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add wallet'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Allowlisted wallets</CardTitle>
          <CardDescription>
            Toggle active or edit sort order inline. Delete removes the row (fee tier reverts to holder/standard rules).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rows yet. Add a wallet above.</p>
          ) : (
            <ul className="space-y-6 divide-y divide-border/60">
              {rows.map((r) => (
                <li key={r.creator_wallet} className="pt-6 first:pt-0 space-y-3">
                  <p className="font-mono text-xs sm:text-sm break-all">{r.creator_wallet}</p>
                  <p className="text-sm text-muted-foreground">
                    Dashboard display name:{' '}
                    <span className="font-medium text-foreground">
                      {r.profile_display_name ?? '— not set (show allowlist label or generic partner text)'}
                    </span>
                  </p>
                  {r.display_label && (
                    <p className="text-sm text-muted-foreground">
                      Allowlist fallback label: <span className="text-foreground">{r.display_label}</span>
                    </p>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                    <label className="flex items-center gap-2 min-h-[44px] touch-manipulation cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.is_active}
                        disabled={savingWallet === r.creator_wallet}
                        onChange={(e) => void patchRow(r.creator_wallet, { is_active: e.target.checked })}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="text-sm">Active</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={`sort-${r.creator_wallet}`} className="text-sm sr-only sm:not-sr-only sm:inline">
                        Sort
                      </Label>
                      <Input
                        id={`sort-${r.creator_wallet}`}
                        inputMode="numeric"
                        className="w-24 font-mono text-sm min-h-[44px] touch-manipulation"
                        defaultValue={String(r.sort_order)}
                        key={`${r.creator_wallet}-${r.sort_order}-${r.updated_at}`}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value.trim(), 10)
                          if (!Number.isFinite(n) || n !== r.sort_order) {
                            void patchRow(r.creator_wallet, { sort_order: Number.isFinite(n) ? n : 0 })
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] touch-manipulation"
                        disabled={savingWallet === r.creator_wallet}
                        onClick={() => {
                          const raw = window.prompt('Allowlist fallback label (empty to clear)', r.display_label ?? '')
                          if (raw === null) return
                          void patchRow(r.creator_wallet, {
                            display_label: raw.trim() === '' ? null : raw.trim(),
                          })
                        }}
                      >
                        Set label
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="min-h-[44px] touch-manipulation"
                        disabled={deletingWallet === r.creator_wallet}
                        onClick={() => void deleteRow(r.creator_wallet)}
                      >
                        {deletingWallet === r.creator_wallet ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 sm:mr-1" />
                            <span className="hidden sm:inline">Delete</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-8 text-xs text-muted-foreground">
        Marketing copy for partners: <Link href="/partner-program" className="underline-offset-2 hover:underline">Partner program</Link>.
      </p>
    </div>
  )
}

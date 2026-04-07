'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin } from '@/lib/admin-check-cache'
import { Users, Loader2, ArrowLeft, Copy, CheckCircle2 } from 'lucide-react'
import type { CommunityGiveaway, PrizeStandard } from '@/lib/types'

export default function AdminCommunityGiveawaysPage() {
  const router = useRouter()
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<'full' | 'raffle_creator' | null>(() => cachedRole)
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [list, setList] = useState<CommunityGiveaway[]>([])
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [verifyId, setVerifyId] = useState<string | null>(null)
  const [verifyTxById, setVerifyTxById] = useState<Record<string, string>>({})
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    access_gate: 'open' as 'open' | 'holder_only',
    starts_at_local: '',
    ends_at_local: '',
    nft_mint_address: '',
    nft_token_id: '',
    prize_standard: '' as '' | PrizeStandard,
    deposit_tx_signature: '',
    notes: '',
  })

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
    fetch(`/api/admin/check?wallet=${addr}`)
      .then((res) => (cancelled ? undefined : res.ok ? res.json() : undefined))
      .then((data) => {
        if (cancelled) return
        const admin = data?.isAdmin === true
        const role = admin && data?.role ? data.role : null
        setCachedAdmin(addr, admin, role)
        setIsAdmin(admin)
        setAdminRole(role)
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

  useEffect(() => {
    if (isAdmin && adminRole === 'raffle_creator') {
      router.replace('/admin/raffles/new')
    }
  }, [isAdmin, adminRole, router])

  const fetchList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/community-giveaways', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setList(Array.isArray(data.giveaways) ? data.giveaways : [])
        setEscrowAddress(typeof data.escrowAddress === 'string' ? data.escrowAddress : null)
      } else {
        setList([])
        setEscrowAddress(null)
      }
    } catch {
      setList([])
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin && adminRole !== 'raffle_creator') {
      void fetchList()
    }
  }, [isAdmin, adminRole, fetchList])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    if (!form.starts_at_local.trim()) {
      setCreateError('starts_at is required (local date & time)')
      return
    }
    const starts_at = new Date(form.starts_at_local).toISOString()
    let ends_at: string | null = null
    if (form.ends_at_local.trim()) {
      ends_at = new Date(form.ends_at_local).toISOString()
    }
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        access_gate: form.access_gate,
        starts_at,
        ends_at,
        nft_mint_address: form.nft_mint_address.trim(),
        deposit_tx_signature: form.deposit_tx_signature.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }
      if (form.nft_token_id.trim()) body.nft_token_id = form.nft_token_id.trim()
      if (form.prize_standard) body.prize_standard = form.prize_standard

      const res = await fetch('/api/admin/community-giveaways', {
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
      setForm({
        title: '',
        description: '',
        access_gate: 'open',
        starts_at_local: '',
        ends_at_local: '',
        nft_mint_address: '',
        nft_token_id: '',
        prize_standard: '',
        deposit_tx_signature: '',
        notes: '',
      })
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  const handleVerify = async (id: string) => {
    setVerifyId(id)
    setActionError(null)
    try {
      const depositTx = verifyTxById[id]?.trim() || undefined
      const res = await fetch(`/api/admin/community-giveaways/${id}/verify-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depositTx ? { deposit_tx: depositTx } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(typeof data.error === 'string' ? data.error : 'Verify failed')
        return
      }
      await fetchList()
    } finally {
      setVerifyId(null)
    }
  }

  const patchStatus = async (id: string, body: Record<string, unknown>) => {
    setActionId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/community-giveaways/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(typeof data.error === 'string' ? data.error : 'Update failed')
        return
      }
      await fetchList()
    } finally {
      setActionId(null)
    }
  }

  const handleDraw = async (id: string) => {
    setActionId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/community-giveaways/${id}/draw`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(typeof data.error === 'string' ? data.error : 'Draw failed')
        return
      }
      await fetchList()
    } finally {
      setActionId(null)
    }
  }

  const copyLink = async (id: string) => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/community-giveaway/${id}`
        : `/community-giveaway/${id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // ignore
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card className="max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Community giveaways</CardTitle>
            <CardDescription>Connect an admin wallet to manage pool giveaways.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="touch-manipulation min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full">
              <WalletConnectButton />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading || isAdmin === null) {
    return (
      <div className="container mx-auto py-8 px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-muted-foreground">Access denied.</p>
        <Button asChild variant="link" className="mt-4">
          <Link href="/admin">Owl Vision</Link>
        </Button>
      </div>
    )
  }

  if (adminRole === 'raffle_creator') {
    return null
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] w-full sm:w-auto">
          <Link href="/admin/giveaways">
            <ArrowLeft className="h-4 w-4 mr-2" />
            NFT giveaways
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] w-full sm:w-auto">
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Owl Vision
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold mb-2 flex items-center gap-2">
        <Users className="h-7 w-7" />
        Community pool giveaways
      </h1>
      <p className="text-muted-foreground text-sm mb-8">
        Deposit the prize NFT to prize escrow (same as raffles), verify, then open for entries. Draw picks a weighted
        random winner (3× weight if a participant paid 3 OWL before <code className="text-xs">starts_at</code>). Winner
        claims from the dashboard. Sign in from Owl Vision if API returns 401.
      </p>

      {escrowAddress && (
        <Card className="mb-8 border-green-500/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Prize escrow address</CardTitle>
          </CardHeader>
          <CardContent>
            <code className="text-xs sm:text-sm break-all block bg-muted/50 rounded-md p-3">{escrowAddress}</code>
          </CardContent>
        </Card>
      )}

      <Card className="mb-10">
        <CardHeader>
          <CardTitle className="text-lg">New community giveaway</CardTitle>
          <CardDescription>
            <code className="text-xs">starts_at</code> closes the OWL boost window (participants can still join after,
            unless <code className="text-xs">ends_at</code> is set).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-title">Title</Label>
                <Input
                  id="cg-title"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-desc">Description (optional)</Label>
                <Input
                  id="cg-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cg-gate">Access</Label>
                <select
                  id="cg-gate"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation min-h-[44px]"
                  value={form.access_gate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, access_gate: e.target.value as 'open' | 'holder_only' }))
                  }
                >
                  <option value="open">Everyone</option>
                  <option value="holder_only">Owl NFT holders only</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cg-starts">Starts at (OWL boost deadline, local)</Label>
                <Input
                  id="cg-starts"
                  type="datetime-local"
                  required
                  value={form.starts_at_local}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at_local: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-ends">Entry deadline (optional, local)</Label>
                <Input
                  id="cg-ends"
                  type="datetime-local"
                  value={form.ends_at_local}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at_local: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-mint">NFT mint / asset id</Label>
                <Input
                  id="cg-mint"
                  required
                  value={form.nft_mint_address}
                  onChange={(e) => setForm((f) => ({ ...f, nft_mint_address: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-tok">NFT token id (optional)</Label>
                <Input
                  id="cg-tok"
                  value={form.nft_token_id}
                  onChange={(e) => setForm((f) => ({ ...f, nft_token_id: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cg-std">Prize standard</Label>
                <select
                  id="cg-std"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation min-h-[44px]"
                  value={form.prize_standard}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, prize_standard: e.target.value as '' | PrizeStandard }))
                  }
                >
                  <option value="">Auto / SPL default</option>
                  <option value="spl">SPL</option>
                  <option value="token2022">Token-2022</option>
                  <option value="mpl_core">MPL Core</option>
                  <option value="compressed">Compressed</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-dep">Deposit tx signature (optional)</Label>
                <Input
                  id="cg-dep"
                  value={form.deposit_tx_signature}
                  onChange={(e) => setForm((f) => ({ ...f, deposit_tx_signature: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cg-notes">Internal notes</Label>
                <Input
                  id="cg-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
            </div>
            <Button type="submit" disabled={creating} className="touch-manipulation min-h-[44px] w-full sm:w-auto">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating…
                </>
              ) : (
                'Create draft'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All community giveaways</CardTitle>
          {actionError && <p className="text-sm text-destructive pt-1">{actionError}</p>}
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No community giveaways yet.</p>
          ) : (
            <ul className="space-y-6">
              {list.map((g) => (
                <li key={g.id} className="border-b border-border/50 pb-6 last:border-0 last:pb-0 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div>
                      <p className="font-medium">{g.title}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">{g.id}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Status: <span className="text-foreground">{g.status}</span> · Gate: {g.access_gate}
                      </p>
                      {g.winner_wallet && (
                        <p className="text-xs text-muted-foreground break-all mt-1">
                          Winner: {g.winner_wallet}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch-manipulation min-h-[44px]"
                        onClick={() => void copyLink(g.id)}
                      >
                        {copiedId === g.id ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy link
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {!g.prize_deposited_at && g.status === 'draft' && (
                    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                      <Input
                        placeholder="Deposit tx (optional)"
                        value={verifyTxById[g.id] ?? ''}
                        onChange={(e) =>
                          setVerifyTxById((m) => ({ ...m, [g.id]: e.target.value }))
                        }
                        className="font-mono text-sm min-h-[44px]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="touch-manipulation min-h-[44px]"
                        disabled={verifyId === g.id}
                        onClick={() => void handleVerify(g.id)}
                      >
                        {verifyId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify deposit'}
                      </Button>
                    </div>
                  )}
                  {g.prize_deposited_at && g.status === 'draft' && (
                    <Button
                      type="button"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={actionId === g.id}
                      onClick={() => void patchStatus(g.id, { status: 'open' })}
                    >
                      Open for entries
                    </Button>
                  )}
                  {g.status === 'open' && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="touch-manipulation min-h-[44px]"
                        disabled={actionId === g.id}
                        onClick={() => void handleDraw(g.id)}
                      >
                        {actionId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Draw winner'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="touch-manipulation min-h-[44px]"
                        disabled={actionId === g.id}
                        onClick={() => void patchStatus(g.id, { status: 'cancelled' })}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

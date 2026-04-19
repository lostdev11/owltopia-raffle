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
import { Gift, Loader2, ArrowLeft, Copy, CheckCircle2 } from 'lucide-react'
import type { NftGiveaway, PrizeStandard } from '@/lib/types'

type ApiRow = NftGiveaway

export default function AdminGiveawaysPage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [list, setList] = useState<ApiRow[]>([])
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [verifyId, setVerifyId] = useState<string | null>(null)
  const [verifyTxById, setVerifyTxById] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [partnerSaveError, setPartnerSaveError] = useState<string | null>(null)
  const [partnerSavingId, setPartnerSavingId] = useState<string | null>(null)
  const [discordPartners, setDiscordPartners] = useState<Array<{ id: string; name: string }>>([])

  const [form, setForm] = useState({
    title: '',
    nft_mint_address: '',
    nft_token_id: '',
    prize_standard: '' as '' | PrizeStandard,
    eligible_wallet: '',
    deposit_tx_signature: '',
    notes: '',
    discord_partner_tenant_id: '',
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
      const res = await fetch('/api/admin/nft-giveaways', { credentials: 'include' })
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

  const fetchDiscordPartners = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/discord-giveaway-partners', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.partners)) {
        setDiscordPartners(
          data.partners.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
        )
      } else {
        setDiscordPartners([])
      }
    } catch {
      setDiscordPartners([])
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      void fetchList()
      void fetchDiscordPartners()
    }
  }, [isAdmin, fetchList, fetchDiscordPartners])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim() || undefined,
        nft_mint_address: form.nft_mint_address.trim(),
        eligible_wallet: form.eligible_wallet.trim(),
        deposit_tx_signature: form.deposit_tx_signature.trim() || undefined,
        notes: form.notes.trim() || undefined,
      }
      if (form.nft_token_id.trim()) body.nft_token_id = form.nft_token_id.trim()
      if (form.prize_standard) body.prize_standard = form.prize_standard
      if (form.discord_partner_tenant_id.trim()) {
        body.discord_partner_tenant_id = form.discord_partner_tenant_id.trim()
      }

      const res = await fetch('/api/admin/nft-giveaways', {
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
        nft_mint_address: '',
        nft_token_id: '',
        prize_standard: '',
        eligible_wallet: '',
        deposit_tx_signature: '',
        notes: '',
        discord_partner_tenant_id: '',
      })
      await fetchList()
    } finally {
      setCreating(false)
    }
  }

  const handleDiscordPartnerChange = async (giveawayId: string, tenantId: string) => {
    setPartnerSaveError(null)
    setPartnerSavingId(giveawayId)
    try {
      const res = await fetch(`/api/admin/nft-giveaways/${giveawayId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discord_partner_tenant_id: tenantId === '' ? null : tenantId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setPartnerSaveError(typeof data.error === 'string' ? data.error : 'Partner update failed')
        return
      }
      await fetchList()
    } finally {
      setPartnerSavingId(null)
    }
  }

  const handleVerify = async (id: string) => {
    setVerifyId(id)
    setVerifyError(null)
    try {
      const depositTx = verifyTxById[id]?.trim() || undefined
      const res = await fetch(`/api/admin/nft-giveaways/${id}/verify-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depositTx ? { deposit_tx: depositTx } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setVerifyError(typeof data.error === 'string' ? data.error : 'Verify failed')
        return
      }
      await fetchList()
    } finally {
      setVerifyId(null)
    }
  }

  const copyLink = async (id: string) => {
    const url =
      typeof window !== 'undefined' ? `${window.location.origin}/giveaway/${id}` : `/giveaway/${id}`
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
            <CardTitle>Legacy one-off NFT giveaways</CardTitle>
            <CardDescription>Connect an admin wallet. Prefer community pool giveaways for the standard workflow.</CardDescription>
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

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild variant="ghost" size="sm" className="touch-manipulation min-h-[44px] w-full sm:w-auto">
          <Link href="/admin/community-giveaways">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Community pool giveaways
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
        <Gift className="h-7 w-7" />
        Legacy one-off NFT giveaways
      </h1>
      <p className="text-muted-foreground text-sm mb-8">
        Eligible-wallet claim links and Discord partner webhooks. For join, draw, and pool entry, use{' '}
        <Link href="/admin/community-giveaways" className="text-primary underline">
          Community pool giveaways
        </Link>
        . Then send the prize NFT to the <span className="text-foreground font-medium">prize escrow</span> (same as raffles), then
        verify here. Only the eligible wallet can claim after verification. If API calls return 401, sign in from{' '}
        <Link href="/admin" className="text-primary underline">
          Owl Vision
        </Link>{' '}
        first.
      </p>

      {escrowAddress && (
        <Card className="mb-8 border-green-500/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Prize escrow address</CardTitle>
            <CardDescription>Creators and admins send giveaway NFTs here.</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="text-xs sm:text-sm break-all block bg-muted/50 rounded-md p-3">{escrowAddress}</code>
          </CardContent>
        </Card>
      )}

      <Card className="mb-10">
        <CardHeader>
          <CardTitle className="text-lg">New giveaway</CardTitle>
          <CardDescription>
            Mint = SPL mint, MPL Core asset id, or compressed asset id as appropriate. For compressed, fill token ID
            if different from mint field. Optional: link a{' '}
            <Link href="/admin/discord-giveaway-partners" className="text-primary underline">
              Discord partner
            </Link>{' '}
            to ping their channel when deposit is verified and when the prize is claimed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-title">Title (optional)</Label>
                <Input
                  id="g-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Discord winner — April"
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-mint">NFT mint / asset id</Label>
                <Input
                  id="g-mint"
                  required
                  value={form.nft_mint_address}
                  onChange={(e) => setForm((f) => ({ ...f, nft_mint_address: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-tok">NFT token id (optional, e.g. compressed)</Label>
                <Input
                  id="g-tok"
                  value={form.nft_token_id}
                  onChange={(e) => setForm((f) => ({ ...f, nft_token_id: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="g-std">Prize standard</Label>
                <select
                  id="g-std"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
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
                <Label htmlFor="g-elig">Eligible wallet</Label>
                <Input
                  id="g-elig"
                  required
                  value={form.eligible_wallet}
                  onChange={(e) => setForm((f) => ({ ...f, eligible_wallet: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-dep">Deposit tx signature (optional, helps verify)</Label>
                <Input
                  id="g-dep"
                  value={form.deposit_tx_signature}
                  onChange={(e) => setForm((f) => ({ ...f, deposit_tx_signature: e.target.value }))}
                  className="min-h-[44px] font-mono text-sm"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-notes">Internal notes</Label>
                <Input
                  id="g-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="g-dp">Discord partner (optional)</Label>
                <select
                  id="g-dp"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
                  value={form.discord_partner_tenant_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, discord_partner_tenant_id: e.target.value }))
                  }
                >
                  <option value="">None</option>
                  {discordPartners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" disabled={creating} className="touch-manipulation min-h-[44px] w-full sm:w-auto">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                'Create giveaway'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All giveaways</CardTitle>
          <CardDescription>Verify deposit after the NFT lands in escrow.</CardDescription>
        </CardHeader>
        <CardContent>
          {verifyError && (
            <p className="text-sm text-destructive mb-4" role="alert">
              {verifyError}
            </p>
          )}
          {partnerSaveError && (
            <p className="text-sm text-destructive mb-4" role="alert">
              {partnerSaveError}
            </p>
          )}
          {loadingList ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No giveaways yet.</p>
          ) : (
            <ul className="space-y-6">
              {list.map((g) => (
                <li key={g.id} className="border-b border-border/60 pb-6 last:border-0 last:pb-0 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start">
                    <div>
                      <p className="font-medium">{g.title?.trim() || 'Untitled'}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all mt-1">{g.nft_mint_address}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Eligible: <span className="font-mono text-foreground">{g.eligible_wallet}</span>
                      </p>
                      <div className="mt-3 space-y-1 max-w-md">
                        <Label className="text-xs text-muted-foreground" htmlFor={`dp-${g.id}`}>
                          Discord partner
                        </Label>
                        <select
                          id={`dp-${g.id}`}
                          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation disabled:opacity-60"
                          value={g.discord_partner_tenant_id ?? ''}
                          disabled={partnerSavingId === g.id || !!g.claimed_at}
                          onChange={(e) => void handleDiscordPartnerChange(g.id, e.target.value)}
                        >
                          <option value="">None</option>
                          {discordPartners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                          {g.discord_partner_tenant_id &&
                          !discordPartners.some((p) => p.id === g.discord_partner_tenant_id) ? (
                            <option value={g.discord_partner_tenant_id}>
                              Current link ({g.discord_partner_tenant_id.slice(0, 8)}…)
                            </option>
                          ) : null}
                        </select>
                        {g.claimed_at ? (
                          <p className="text-xs text-muted-foreground">
                            Partner link cannot be changed after claim.
                          </p>
                        ) : discordPartners.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No partners in the list yet — add one under{' '}
                            <Link href="/admin/discord-giveaway-partners" className="underline">
                              Discord giveaway partners
                            </Link>
                            .
                          </p>
                        ) : partnerSavingId === g.id ? (
                          <p className="text-xs text-muted-foreground">Saving…</p>
                        ) : null}
                      </div>
                      <p className="text-xs mt-1">
                        {g.claimed_at ? (
                          <span className="text-green-600 dark:text-green-400">Claimed</span>
                        ) : g.prize_deposited_at ? (
                          <span className="text-amber-600 dark:text-amber-400">Ready to claim</span>
                        ) : (
                          <span className="text-muted-foreground">Deposit not verified</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="touch-manipulation min-h-[44px]"
                        onClick={() => copyLink(g.id)}
                      >
                        {copiedId === g.id ? (
                          <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Copy link
                      </Button>
                    </div>
                  </div>
                  {!g.prize_deposited_at && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Deposit tx (optional)</Label>
                        <Input
                          value={verifyTxById[g.id] ?? ''}
                          onChange={(e) =>
                            setVerifyTxById((m) => ({ ...m, [g.id]: e.target.value }))
                          }
                          placeholder="Signature for stricter mint match"
                          className="font-mono text-xs min-h-[44px]"
                        />
                      </div>
                      <Button
                        type="button"
                        className="touch-manipulation min-h-[44px] shrink-0"
                        disabled={verifyId === g.id}
                        onClick={() => handleVerify(g.id)}
                      >
                        {verifyId === g.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Verify deposit'
                        )}
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

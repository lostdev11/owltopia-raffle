'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin } from '@/lib/admin-check-cache'
import { localDateTimeToUtc } from '@/lib/utils'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { Gift, ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { CommunityGiveawayPrizeEscrowPanel } from '@/components/CommunityGiveawayPrizeEscrowPanel'

/** Use proxy for external NFT image URLs (same as CreateRaffleForm). */
function getProxiedImageUrl(url: string | null): string | null {
  if (!url?.trim()) return null
  const u = url.trim()
  if (u.startsWith('/') && !u.startsWith('//')) return u
  return `/api/proxy-image?url=${encodeURIComponent(u)}`
}

type GiveawayRow = {
  id: string
  title: string
  description: string | null
  access_gate: string
  starts_at: string
  ends_at: string | null
  status: string
  prize_deposited_at: string | null
  nft_mint_address: string | null
  nft_token_id?: string | null
  nft_metadata_uri?: string | null
  prize_standard?: string | null
  prize_deposit_tx?: string | null
  created_at?: string
}

function isPublicLive(g: Pick<GiveawayRow, 'status' | 'prize_deposited_at'>): boolean {
  return g.status === 'open' && !!g.prize_deposited_at
}

export default function AdminCommunityGiveawaysPage() {
  const router = useRouter()
  const { publicKey, connected, signMessage: walletSignMessage } = useWallet()
  const { connection } = useConnection()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const cachedRole = typeof window !== 'undefined' && wallet ? getCachedAdminRole(wallet) : null
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [adminRole, setAdminRole] = useState<'full' | 'raffle_creator' | null>(() => cachedRole)
  const [loading, setLoading] = useState(() => !cachedTrue)
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [giveaways, setGiveaways] = useState<GiveawayRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)

  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [loadingWalletAssets, setLoadingWalletAssets] = useState(false)
  const [walletAssetsError, setWalletAssetsError] = useState<string | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)

  const [startsAt, setStartsAt] = useState(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const h = String(now.getHours()).padStart(2, '0')
    const min = String(now.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d}T${h}:${min}`
  })
  const [endsAt, setEndsAt] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    access_gate: 'open' as 'open' | 'holder_only',
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
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { cache: 'no-store' })
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

  useEffect(() => {
    if (!connected || !publicKey || !isAdmin) {
      setSessionReady(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' }).then((res) => {
      if (!cancelled) setSessionReady(res.ok)
    })
    return () => {
      cancelled = true
    }
  }, [connected, publicKey, isAdmin])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !walletSignMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const nonceRes = await fetch(
        `/api/auth/nonce?wallet=${encodeURIComponent(publicKey.toBase58())}`,
        { credentials: 'include' }
      )
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to get sign-in nonce')
      }
      const { message } = await nonceRes.json()
      const messageBytes = new TextEncoder().encode(message)
      const signature = await walletSignMessage(messageBytes)
      const signatureBase64 =
        typeof signature === 'string'
          ? btoa(signature)
          : btoa(String.fromCharCode(...new Uint8Array(signature)))
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          message,
          signature: signatureBase64,
        }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data?.error || 'Sign-in verification failed')
      }
      setSessionReady(true)
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, walletSignMessage])

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/community-giveaways', {
        credentials: 'include',
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(typeof data?.error === 'string' ? data.error : 'Could not load giveaways')
        setGiveaways([])
        return
      }
      setGiveaways(Array.isArray(data?.giveaways) ? data.giveaways : [])
    } catch {
      setListError('Network error')
      setGiveaways([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin && sessionReady === true && adminRole === 'full') {
      void loadList()
    }
  }, [isAdmin, sessionReady, adminRole, loadList])

  const loadWalletAssets = async () => {
    if (!publicKey) return
    setLoadingWalletAssets(true)
    setWalletAssetsError(null)
    const walletAddr = publicKey.toBase58()
    try {
      const [apiRes, escrowRes] = await Promise.all([
        fetch(`/api/wallet/nfts?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
        fetch(`/api/wallet/escrowed-nft-mints?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
      ])
      let nfts: WalletNft[] = []
      if (apiRes.ok) {
        const data = await apiRes.json()
        nfts = Array.isArray(data) ? data : []
      }
      if (nfts.length === 0 || apiRes.status === 503) {
        const { getWalletNfts } = await import('@/lib/solana/wallet-tokens')
        try {
          nfts = await getWalletNfts(connection, publicKey)
        } catch (rpcErr) {
          if (nfts.length === 0) throw rpcErr
        }
      }
      if (nfts.length > 0 && !apiRes.ok) {
        try {
          const blockRes = await fetch('/api/config/scam-blocklist', { credentials: 'include' })
          if (blockRes.ok) {
            const { addresses } = await blockRes.json()
            if (Array.isArray(addresses) && addresses.length > 0) {
              const blockSet = new Set((addresses as string[]).map((a) => a.toLowerCase()))
              nfts = nfts.filter((n) => !blockSet.has(n.mint.toLowerCase()))
            }
          }
        } catch {
          // ignore
        }
      }
      if (escrowRes.ok) {
        try {
          const { mints: escrowedMints } = await escrowRes.json()
          if (Array.isArray(escrowedMints) && escrowedMints.length > 0) {
            const escrowedSet = new Set(escrowedMints.map((m: string) => m.toLowerCase()))
            nfts = nfts.filter((n) => !escrowedSet.has(n.mint.toLowerCase()))
          }
        } catch {
          // ignore
        }
      }
      setWalletNfts(nfts)
      setNftSearchQuery('')
    } catch (e) {
      console.error('Load wallet assets:', e)
      setWalletAssetsError(e instanceof Error ? e.message : 'Failed to load NFTs')
      setWalletNfts(null)
    } finally {
      setLoadingWalletAssets(false)
    }
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setSaveError('Title is required')
      return
    }
    if (!selectedNft) {
      setSaveError('Select a prize NFT from your wallet (same as creating a raffle).')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const starts_iso = localDateTimeToUtc(startsAt)
      const ends_iso =
        endsAt.trim() === ''
          ? null
          : (() => {
              try {
                return localDateTimeToUtc(endsAt)
              } catch {
                return null
              }
            })()
      const res = await fetch('/api/admin/community-giveaways', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          access_gate: form.access_gate,
          starts_at: starts_iso,
          ends_at: ends_iso,
          nft_mint_address: selectedNft.mint,
          nft_metadata_uri: selectedNft.metadataUri ?? null,
          nft_token_id: selectedNft.mint,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(typeof data?.error === 'string' ? data.error : 'Save failed')
        return
      }
      setForm({ title: '', description: '', access_gate: 'open' })
      setSelectedNft(null)
      setWalletNfts(null)
      await loadList()
    } catch {
      setSaveError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const patchGiveaway = async (id: string, body: Record<string, unknown>) => {
    setActionId(id)
    try {
      const res = await fetch(`/api/admin/community-giveaways/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(typeof data?.error === 'string' ? data.error : 'Update failed')
        return
      }
      await loadList()
    } catch {
      alert('Network error')
    } finally {
      setActionId(null)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Checking access…</p>
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Community giveaways</CardTitle>
            <CardDescription>Connect a wallet to continue.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center touch-manipulation min-h-[44px]">
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isAdmin || adminRole !== 'full') {
    return (
      <div className="container mx-auto py-8 px-4 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>Only full admins can manage community giveaways.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Owl Vision</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (sessionReady === false) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>Sign in with your admin wallet (same as Owl Vision).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {signInError && <p className="text-sm text-destructive">{signInError}</p>}
            <Button
              onClick={handleSignIn}
              disabled={signingIn || !walletSignMessage}
              className="touch-manipulation min-h-[44px]"
            >
              {signingIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Signing…
                </>
              ) : (
                'Sign in with wallet'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (sessionReady !== true) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verifying session…
        </p>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="touch-manipulation min-h-[44px] mb-4">
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Owl Vision
          </Link>
        </Button>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Gift className="h-8 w-8" />
          Community giveaways
        </h1>
        <p className="text-muted-foreground mt-2">
          Same prize flow as NFT raffles: pick the prize NFT from your wallet, create a draft, transfer it to platform
          escrow, verify on-chain, then set status to <strong>open</strong>. Discord notifies when a giveaway first
          becomes public (if webhook env vars are set).
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Create giveaway (draft)</CardTitle>
          <CardDescription>
            Load NFTs from the connected wallet, select the prize, then submit. Deposit + verify in the list below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <Label>NFT prize (from your wallet)</Label>
              <p className="text-xs text-muted-foreground">
                Uses the same wallet NFT list as raffle creation (Helius API when configured, else RPC).
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadWalletAssets()}
                disabled={loadingWalletAssets || !publicKey}
                className="touch-manipulation min-h-[44px]"
              >
                {loadingWalletAssets ? 'Loading…' : 'Load NFTs from wallet'}
              </Button>
              {walletAssetsError && <p className="text-sm text-destructive">{walletAssetsError}</p>}
              {walletNfts && walletNfts.length === 0 && !loadingWalletAssets && (
                <p className="text-sm text-muted-foreground">No NFTs found in this wallet.</p>
              )}
              {walletNfts && walletNfts.length > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="nft-search" className="text-xs">
                      Search NFTs
                    </Label>
                    <Input
                      id="nft-search"
                      type="text"
                      placeholder="Name, collection, or mint…"
                      value={nftSearchQuery}
                      onChange={(e) => setNftSearchQuery(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[240px] overflow-y-auto touch-pan-y">
                    {(() => {
                      const q = nftSearchQuery.trim().toLowerCase()
                      const filtered = q
                        ? walletNfts.filter(
                            (nft) =>
                              (nft.name?.toLowerCase().includes(q)) ||
                              (nft.collectionName?.toLowerCase().includes(q)) ||
                              nft.mint.toLowerCase().includes(q)
                          )
                        : walletNfts
                      return filtered.length === 0 ? (
                        <p className="col-span-full text-sm text-muted-foreground py-2">No matches.</p>
                      ) : (
                        filtered.map((nft) => (
                          <button
                            key={nft.tokenAccount}
                            type="button"
                            onClick={() => setSelectedNft(nft)}
                            className={`rounded-lg border-2 p-2 text-left transition-colors touch-manipulation min-h-[44px] ${
                              selectedNft?.mint === nft.mint
                                ? 'border-primary bg-primary/10'
                                : 'border-border hover:border-muted-foreground/50'
                            }`}
                          >
                            <div className="aspect-square rounded overflow-hidden bg-muted mb-2">
                              {nft.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={getProxiedImageUrl(nft.image) ?? nft.image}
                                  alt={nft.name ?? nft.mint}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const el = e.currentTarget
                                    if (nft.image && el.src !== nft.image) el.src = nft.image
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                                  No image
                                </div>
                              )}
                            </div>
                            <p className="text-xs font-medium truncate" title={nft.name ?? nft.mint}>
                              {nft.name ?? `${nft.mint.slice(0, 4)}…`}
                            </p>
                          </button>
                        ))
                      )
                    })()}
                  </div>
                </>
              )}
              {selectedNft && (
                <p className="text-sm text-muted-foreground">
                  Selected: {selectedNft.name ?? selectedNft.mint}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="cg-title">Title</Label>
              <Input
                id="cg-title"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="cg-desc">Description (optional)</Label>
              <textarea
                id="cg-desc"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="mt-1 w-full min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cg-access">Access</Label>
                <select
                  id="cg-access"
                  value={form.access_gate}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, access_gate: e.target.value as 'open' | 'holder_only' }))
                  }
                  className="mt-1 w-full h-11 rounded-md border border-input bg-background px-3 text-sm touch-manipulation min-h-[44px]"
                >
                  <option value="open">Everyone</option>
                  <option value="holder_only">Owl holders only</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="cg-start">Starts (local time)</Label>
                <Input
                  id="cg-start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="mt-1 touch-manipulation min-h-[44px]"
                />
              </div>
              <div>
                <Label htmlFor="cg-end">Entry deadline (optional)</Label>
                <Input
                  id="cg-end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="mt-1 touch-manipulation min-h-[44px]"
                />
              </div>
            </div>
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}
            <Button type="submit" disabled={saving} className="touch-manipulation min-h-[44px] w-full sm:w-auto">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                'Create draft giveaway'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your giveaways</CardTitle>
          <CardDescription>
            For each row: complete escrow transfer + verify, then Open / live. Applies migration 045 for full escrow
            field parity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : listError ? (
            <p className="text-destructive text-sm">{listError}</p>
          ) : giveaways.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rows yet.</p>
          ) : (
            <ul className="space-y-6">
              {giveaways.map((g) => (
                <li key={g.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{g.title}</p>
                      <p className="text-xs text-muted-foreground font-mono break-all">{g.id}</p>
                    </div>
                    <span className="text-xs rounded-full border px-2 py-1 shrink-0">{g.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Prize deposited: {g.prize_deposited_at ? new Date(g.prize_deposited_at).toLocaleString() : '—'}
                  </p>
                  <CommunityGiveawayPrizeEscrowPanel giveaway={g} onUpdated={loadList} />
                  {isPublicLive(g) && (
                    <Link
                      href={`/community-giveaway/${g.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary inline-flex items-center gap-1 touch-manipulation min-h-[44px]"
                    >
                      Public page <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={actionId === g.id || g.status === 'open' || !g.prize_deposited_at}
                      onClick={() => patchGiveaway(g.id, { status: 'open' })}
                    >
                      Open / live
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={actionId === g.id}
                      onClick={() => patchGiveaway(g.id, { status: 'closed' })}
                    >
                      Close
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="touch-manipulation min-h-[44px]"
                      disabled={actionId === g.id}
                      onClick={() => patchGiveaway(g.id, { status: 'draft' })}
                    >
                      Set draft
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

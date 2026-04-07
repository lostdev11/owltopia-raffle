'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { getCachedAdmin, getCachedAdminRole, setCachedAdmin } from '@/lib/admin-check-cache'
import { depositPrizeNftToEscrowFromWallet } from '@/lib/solana/deposit-prize-nft-to-escrow-wallet'
import {
  logEscrowDepositError,
  logEscrowDepositVerify,
} from '@/lib/solana/escrow-deposit-log'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import {
  verifyCommunityGiveawayDepositWithRetries,
  isEscrowSplPrizeFrozenVerifyError,
} from '@/lib/raffles/verify-prize-deposit-client'
import { Users, Loader2, ArrowLeft, Copy, CheckCircle2 } from 'lucide-react'
import type { CommunityGiveaway, PrizeStandard } from '@/lib/types'

export default function AdminCommunityGiveawaysPage() {
  const router = useRouter()
  const { publicKey, connected, sendTransaction, wallet } = useWallet()
  const { connection } = useConnection()
  const connectedWallet = publicKey?.toBase58() ?? ''
  const cachedTrue =
    typeof window !== 'undefined' && connectedWallet && getCachedAdmin(connectedWallet) === true
  const cachedRole =
    typeof window !== 'undefined' && connectedWallet ? getCachedAdminRole(connectedWallet) : null
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

  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)
  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [loadingWalletNfts, setLoadingWalletNfts] = useState(false)
  const [walletNftsError, setWalletNftsError] = useState<string | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [depositingId, setDepositingId] = useState<string | null>(null)

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

  const loadWalletNfts = useCallback(async () => {
    if (!publicKey) return
    setLoadingWalletNfts(true)
    setWalletNftsError(null)
    const walletAddr = publicKey.toBase58()
    try {
      const [apiRes, escrowRes] = await Promise.all([
        fetch(`/api/wallet/nfts?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
        fetch(`/api/wallet/escrowed-nft-mints?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        }),
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
      console.error('Load wallet NFTs:', e)
      setWalletNftsError(e instanceof Error ? e.message : 'Failed to load NFTs')
      setWalletNfts(null)
    } finally {
      setLoadingWalletNfts(false)
    }
  }, [publicKey, connection])

  useEffect(() => {
    if (connected && publicKey && isAdmin && adminRole !== 'raffle_creator') {
      void loadWalletNfts()
    }
  }, [connected, publicKey, isAdmin, adminRole, loadWalletNfts])

  const runDepositAndVerify = useCallback(
    async (giveawayId: string, prizeMint: string, nft: WalletNft): Promise<boolean> => {
      if (!publicKey || !escrowAddress) {
        setActionError('Connect wallet and ensure prize escrow is configured.')
        return false
      }
      const logCtx = {
        communityGiveawayId: giveawayId,
        nftMint: prizeMint.trim(),
        transferAssetId: nft.mint,
        escrowAddress,
        fromWallet: publicKey.toBase58(),
      }
      try {
        const dep = await depositPrizeNftToEscrowFromWallet({
          connection,
          publicKey,
          sendTransaction,
          walletAdapter: wallet?.adapter ?? null,
          selectedNft: nft,
          prizeMintAddress: prizeMint.trim(),
          escrowAddress,
          logCtx,
        })
        if (!dep.ok) {
          setActionError(dep.error)
          return false
        }
        const verifyResult = await verifyCommunityGiveawayDepositWithRetries(giveawayId, {
          depositTx: dep.signature,
        })
        logEscrowDepositVerify(logCtx, verifyResult.ok, verifyResult.ok ? undefined : verifyResult.error)
        if (!verifyResult.ok) {
          if (verifyResult.status === 401) {
            setActionError('Sign in from Owl Vision, then verify deposit again if needed.')
          } else if (isEscrowSplPrizeFrozenVerifyError(verifyResult.error)) {
            const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
            const d = verifyResult.frozenEscrowDiagnostics
            const links = d
              ? ` Escrow token account: https://solscan.io/account/${encodeURIComponent(d.escrowTokenAccount)}${q}`
              : ''
            setActionError(verifyResult.error + links)
          } else {
            setActionError(
              verifyResult.error ||
                'Transfer may have succeeded; wait a moment and tap Verify deposit, or check Solscan.'
            )
          }
          return false
        }
        return true
      } catch (err) {
        logEscrowDepositError(logCtx, err)
        setActionError(err instanceof Error ? err.message : 'Deposit failed')
        return false
      }
    },
    [publicKey, escrowAddress, connection, sendTransaction, wallet?.adapter]
  )

  useEffect(() => {
    if (isAdmin && adminRole !== 'raffle_creator') {
      void fetchList()
    }
  }, [isAdmin, adminRole, fetchList])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    const mintTrim = form.nft_mint_address.trim()
    if (!mintTrim) {
      setCreateError('Select a prize NFT from your wallet or paste its mint / asset id.')
      return
    }
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
      const created = data.giveaway as CommunityGiveaway | undefined
      const nftForDeposit =
        selectedNft && selectedNft.mint.trim() === mintTrim ? selectedNft : null

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
      setSelectedNft(null)
      setNftSearchQuery('')

      if (
        created?.id &&
        escrowAddress &&
        nftForDeposit &&
        !created.prize_deposited_at &&
        publicKey &&
        wallet?.adapter
      ) {
        setActionError(null)
        setDepositingId(created.id)
        try {
          await runDepositAndVerify(created.id, mintTrim, nftForDeposit)
        } finally {
          setDepositingId(null)
        }
      }

      await fetchList()
      await loadWalletNfts()
    } finally {
      setCreating(false)
    }
  }

  const handleSendPrizeToEscrow = async (g: CommunityGiveaway) => {
    const mint = g.nft_mint_address.trim()
    const nft = walletNfts?.find((n) => n.mint === mint) ?? null
    if (!nft) {
      setActionError('This wallet must hold the prize NFT. Tap Refresh NFTs, then try again.')
      await loadWalletNfts()
      return
    }
    setDepositingId(g.id)
    setActionError(null)
    try {
      const ok = await runDepositAndVerify(g.id, mint, nft)
      if (ok) await fetchList()
    } finally {
      setDepositingId(null)
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
        Use the same <strong>prize escrow</strong> as NFT raffles: pick the NFT from your connected wallet, create the
        giveaway, then sign to send it to escrow (or use &quot;Send NFT to escrow&quot; on a draft). Verify, then open
        for entries. Draw uses weighted entries (OWL boosts before <code className="text-xs">starts_at</code>). Winner
        claims from the dashboard. Sign in from Owl Vision if the API returns 401.
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
            unless <code className="text-xs">ends_at</code> is set). Choose the prize NFT below (same escrow flow as
            creating an NFT raffle).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div
              id="cg-nft-prize-section"
              className="rounded-lg border border-border p-4 space-y-3 touch-manipulation"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                <p className="text-sm font-medium">Prize NFT from wallet</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] w-full sm:w-auto"
                  onClick={() => void loadWalletNfts()}
                  disabled={loadingWalletNfts || !publicKey}
                >
                  {loadingWalletNfts ? 'Loading…' : 'Refresh NFTs'}
                </Button>
              </div>
              {walletNftsError && <p className="text-sm text-destructive">{walletNftsError}</p>}
              {walletNfts && walletNfts.length === 0 && !loadingWalletNfts && (
                <p className="text-sm text-muted-foreground">
                  No NFTs in this wallet (check network). You can still paste a mint below and deposit after create.
                </p>
              )}
              {walletNfts && walletNfts.length > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="cg-nft-search" className="text-xs">
                      Search
                    </Label>
                    <Input
                      id="cg-nft-search"
                      type="text"
                      placeholder="Name, collection, or mint…"
                      value={nftSearchQuery}
                      onChange={(e) => setNftSearchQuery(e.target.value)}
                      className="text-sm min-h-[44px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[240px] overflow-y-auto">
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
                      if (filtered.length === 0) {
                        return (
                          <p className="col-span-full text-sm text-muted-foreground py-2">
                            {q ? 'No matches.' : 'No NFTs.'}
                          </p>
                        )
                      }
                      return filtered.map((nft) => (
                        <button
                          key={nft.tokenAccount}
                          type="button"
                          onClick={() => {
                            setSelectedNft(nft)
                            setForm((f) => ({
                              ...f,
                              nft_mint_address: nft.mint,
                              nft_token_id: f.nft_token_id.trim() ? f.nft_token_id : nft.mint,
                            }))
                          }}
                          className={`rounded-lg border-2 p-2 text-left transition-colors min-h-[44px] ${
                            selectedNft?.mint === nft.mint
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-muted-foreground/50'
                          }`}
                        >
                          <div className="aspect-square rounded overflow-hidden bg-muted mb-2">
                            {nft.image ? (
                              <img
                                src={getRaffleDisplayImageUrl(nft.image) ?? nft.image}
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
                    })()}
                  </div>
                </>
              )}
              {selectedNft && (
                <p className="text-sm text-muted-foreground">
                  Selected mint: <span className="font-mono text-xs break-all">{selectedNft.mint}</span>
                </p>
              )}
            </div>
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
                  onChange={(e) => {
                    const v = e.target.value
                    setForm((f) => ({ ...f, nft_mint_address: v }))
                    if (selectedNft && v.trim() !== selectedNft.mint) setSelectedNft(null)
                  }}
                  className="min-h-[44px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Filled when you tap an NFT above, or paste manually for Core / compressed IDs.
                </p>
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
            <Button
              type="submit"
              disabled={creating || !!depositingId}
              className="touch-manipulation min-h-[44px] w-full sm:w-auto"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {depositingId ? 'Sign deposit to escrow…' : 'Creating draft…'}
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
                    <div className="space-y-2">
                      {escrowAddress && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="touch-manipulation min-h-[44px] w-full sm:w-auto"
                          disabled={depositingId === g.id || !publicKey}
                          onClick={() => void handleSendPrizeToEscrow(g)}
                        >
                          {depositingId === g.id ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Sending to escrow…
                            </>
                          ) : (
                            'Send NFT to escrow (wallet)'
                          )}
                        </Button>
                      )}
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

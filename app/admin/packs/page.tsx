'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCachedAdmin, setCachedAdmin, getCachedAdminRole } from '@/lib/admin-check-cache'
import { ArrowLeft, Loader2 } from 'lucide-react'

type AdminPacksData = {
  vault: {
    configuredAddress: string | null
    paused: boolean
    pauseReason: string | null
    minNftCount: number
    owlSolPrice: number | null
    solBalance: number | null
    availableNfts: number
  }
  ev: {
    estimatedEvSol: number
    estimatedRtpBps: number
    targetEvSol: number
    notes: string[]
  }
  inventory: {
    id: string
    mint_address: string
    name: string | null
    fair_value_sol: number
    status: string
  }[]
}

export default function AdminPacksPage() {
  const { publicKey, connected } = useWallet()
  const [isAdmin, setIsAdmin] = useState(false)
  const [checking, setChecking] = useState(true)
  const [data, setData] = useState<AdminPacksData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mint, setMint] = useState('')
  const [fair, setFair] = useState('0.1')
  const [name, setName] = useState('')
  const [owlPrice, setOwlPrice] = useState('')

  useEffect(() => {
    if (!connected || !publicKey) {
      setIsAdmin(false)
      setChecking(false)
      return
    }
    const cached = getCachedAdmin(publicKey.toBase58())
    if (cached !== null) {
      setIsAdmin(cached && getCachedAdminRole(publicKey.toBase58()) === 'full')
      setChecking(false)
      return
    }
    void (async () => {
      try {
        const res = await fetch(`/api/admin/check?wallet=${publicKey.toBase58()}`)
        const json = await res.json()
        const ok = Boolean(json.isAdmin && json.role === 'full')
        setCachedAdmin(publicKey.toBase58(), Boolean(json.isAdmin), json.role)
        setIsAdmin(ok)
      } catch {
        setIsAdmin(false)
      } finally {
        setChecking(false)
      }
    })()
  }, [connected, publicKey])

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/packs', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setData(json)
      if (json.vault?.owlSolPrice != null) setOwlPrice(String(json.vault.owlSolPrice))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  async function patchVault(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/packs', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Update failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function addNft() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/packs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mint_address: mint.trim(),
          fair_value_sol: Number(fair),
          name: name.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Add failed')
      setMint('')
      setName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function removeNft(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/packs?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Remove failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!connected) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="mb-4 text-muted-foreground">Connect an admin wallet to manage packs.</p>
        <WalletConnectButton />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-muted-foreground">
        Full admin access required.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Admin
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Packs vault</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fund the packs wallet with SOL, $OWL, and NFTs. Unpause when inventory is ready for admin
        preview testing at{' '}
        <Link href="/packs" className="text-theme-prime underline-offset-2 hover:underline">
          /packs
        </Link>
        . All pack purchase SOL lands in this vault; prizes pay out from it. Public launch still
        requires <code className="text-xs">PACKS_PUBLIC=true</code>.
      </p>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {data && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border p-4 text-sm">
            <p>
              Vault:{' '}
              <span className="font-mono text-xs">
                {data.vault.configuredAddress || 'not configured'}
              </span>
            </p>
            <p className="mt-1">
              Status:{' '}
              <strong>{data.vault.paused ? 'PAUSED' : 'LIVE'}</strong>
              {data.vault.pauseReason ? ` — ${data.vault.pauseReason}` : ''}
            </p>
            <p className="mt-1">
              SOL balance: {data.vault.solBalance ?? '—'} · NFTs available:{' '}
              {data.vault.availableNfts} (min {data.vault.minNftCount})
            </p>
            <p className="mt-1">
              EV est. {data.ev.estimatedEvSol.toFixed(4)} SOL (target {data.ev.targetEvSol}) · RTP{' '}
              {data.ev.estimatedRtpBps} bps
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                variant={data.vault.paused ? 'default' : 'secondary'}
                onClick={() => void patchVault({ paused: !data.vault.paused })}
              >
                {data.vault.paused ? 'Unpause packs' : 'Pause packs'}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <Label htmlFor="owl-price">OWL/SOL price (for EV)</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id="owl-price"
                value={owlPrice}
                onChange={(e) => setOwlPrice(e.target.value)}
                placeholder="e.g. 0.002"
              />
              <Button
                disabled={busy}
                onClick={() =>
                  void patchVault({
                    owl_sol_price: owlPrice.trim() === '' ? null : Number(owlPrice),
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="font-medium">Add NFT to inventory</h2>
            <p className="text-xs text-muted-foreground">
              Deposit the NFT to the vault wallet on-chain first, then register it here (fair value
              0.05–0.5 SOL).
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Mint</Label>
                <Input value={mint} onChange={(e) => setMint(e.target.value)} />
              </div>
              <div>
                <Label>Fair value (SOL)</Label>
                <Input value={fair} onChange={(e) => setFair(e.target.value)} />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <Button className="mt-3" disabled={busy} onClick={() => void addNft()}>
              Add NFT
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="font-medium">Inventory</h2>
            <ul className="mt-3 divide-y text-sm">
              {data.inventory.length === 0 && (
                <li className="py-3 text-muted-foreground">No items</li>
              )}
              {data.inventory.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-mono text-xs">{item.mint_address}</p>
                    <p className="text-muted-foreground">
                      {item.name || 'NFT'} · {item.fair_value_sol} SOL · {item.status}
                    </p>
                  </div>
                  {item.status === 'available' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void removeNft(item.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

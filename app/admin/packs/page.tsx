'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminPacksInventoryForm } from '@/components/admin/AdminPacksInventoryForm'
import { PacksOpeningPreviewPanel } from '@/components/admin/PacksOpeningPreviewPanel'
import { PacksLaunchChecklist } from '@/components/admin/PacksLaunchChecklist'
import { PacksAdminExtraDetails } from '@/components/admin/PacksAdminExtraDetails'
import { getCachedAdmin, setCachedAdmin, getCachedAdminRole } from '@/lib/admin-check-cache'
import { packPauseReasonLabel, packRtpPercentLabel } from '@/lib/packs/admin-copy'
import { packNftBandLabel } from '@/lib/packs/ev-simulator'
import { packInventoryPrizeStandardLabel } from '@/lib/packs/types'
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
  fairness?: {
    openAlgo: string
    vrfEnabled: boolean
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
    image_url?: string | null
    fair_value_sol: number
    prize_standard?: string | null
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

  const pauseLabel = data ? packPauseReasonLabel(data.vault.pauseReason) : null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Admin
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Packs vault</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The{' '}
        <Link href="/packs" className="text-theme-prime underline-offset-2 hover:underline">
          /packs
        </Link>{' '}
        page is public. Buying stays off until you turn packs on below. Fund the vault with SOL,
        $OWL, and prize NFTs first — purchases go into this wallet, and prizes pay out from it.
      </p>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {data && (
        <div className="mt-6 space-y-6">
          <PacksLaunchChecklist
            vaultConfigured={Boolean(data.vault.configuredAddress)}
            solBalance={data.vault.solBalance}
            owlSolPrice={data.vault.owlSolPrice}
            availableNfts={data.vault.availableNfts}
            estimatedEvSol={data.ev.estimatedEvSol}
            estimatedRtpBps={data.ev.estimatedRtpBps}
            paused={data.vault.paused}
            vrfEnabled={Boolean(data.fairness?.vrfEnabled)}
          />

          <div className="rounded-lg border p-4 text-sm">
            <p>
              Vault:{' '}
              <span className="font-mono text-xs break-all">
                {data.vault.configuredAddress || 'not set up yet'}
              </span>
            </p>
            <p className="mt-1">
              Status:{' '}
              <strong>{data.vault.paused ? 'Paused' : 'On'}</strong>
              {pauseLabel ? ` — ${pauseLabel}` : ''}
            </p>
            <p className="mt-1">
              SOL in vault: {data.vault.solBalance ?? '—'} · Prize NFTs ready:{' '}
              {data.vault.availableNfts} (need at least {data.vault.minNftCount})
            </p>
            <p className="mt-1">
              Typical prize: about {data.ev.estimatedEvSol.toFixed(4)} SOL (aiming for{' '}
              {data.ev.targetEvSol} SOL). Players get back about{' '}
              {packRtpPercentLabel(data.ev.estimatedRtpBps)} of the pack price.
            </p>
            <PacksAdminExtraDetails notes={data.ev.notes}>
              <p className="text-xs text-muted-foreground">
                Turning packs on makes buying live for everyone on /packs. Return-to-player
                estimate: {(data.ev.estimatedRtpBps / 100).toFixed(2)}% (
                {data.ev.estimatedRtpBps} bps).
              </p>
            </PacksAdminExtraDetails>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="min-h-[44px] touch-manipulation"
                disabled={busy}
                variant={data.vault.paused ? 'default' : 'secondary'}
                onClick={() => void patchVault({ paused: !data.vault.paused })}
              >
                {data.vault.paused ? 'Turn packs on' : 'Turn packs off'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="min-h-[44px] touch-manipulation"
                disabled={busy}
                onClick={() => void load()}
              >
                Refresh
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <Label htmlFor="owl-price">OWL price in SOL</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Used to estimate how much $OWL prizes are worth.
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                id="owl-price"
                value={owlPrice}
                onChange={(e) => setOwlPrice(e.target.value)}
                placeholder="e.g. 0.002"
                className="min-h-[44px] touch-manipulation"
              />
              <Button
                className="min-h-[44px] shrink-0 touch-manipulation"
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

          <PacksOpeningPreviewPanel />

          <div className="rounded-lg border p-4">
            <AdminPacksInventoryForm
              vaultAddress={data.vault.configuredAddress}
              inventory={data.inventory}
              owlSolPrice={data.vault.owlSolPrice}
              onRegistered={load}
            />
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="font-medium">Inventory</h2>
            <p className="text-xs text-muted-foreground">
              Remove only unlists the row. It does not send the NFT back from the vault.
            </p>
            <ul className="mt-3 divide-y text-sm">
              {data.inventory.length === 0 && (
                <li className="py-3 text-muted-foreground">No items</li>
              )}
              {data.inventory.map((item) => {
                const band = packNftBandLabel(Number(item.fair_value_sol))
                return (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-muted" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.name || 'NFT'}</p>
                        <p className="font-mono text-xs text-muted-foreground break-all">
                          {item.mint_address}
                        </p>
                        <p className="text-muted-foreground">
                          {item.fair_value_sol} SOL
                          {band ? ` · ${band}` : ''} ·{' '}
                          {packInventoryPrizeStandardLabel(item.prize_standard)} · {item.status}
                        </p>
                      </div>
                    </div>
                    {item.status === 'available' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-[44px] shrink-0 touch-manipulation"
                        disabled={busy}
                        onClick={() => void removeNft(item.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

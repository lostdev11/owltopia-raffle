'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, CheckCircle2, Copy, Loader2, Store } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getCachedAdmin, setCachedAdmin } from '@/lib/admin-check-cache'
import type {
  DiscordMarketplaceShopItem,
  ShopDepositKind,
  ShopPriceCurrency,
} from '@/lib/db/discord-marketplace-shop-items'

type DepositOption = {
  kind: ShopDepositKind
  label: string
  hint: string
  needsMint: boolean
  needsOwlUnits: boolean
  allowTreasuryFunded: boolean
}

const DEPOSIT_OPTIONS: DepositOption[] = [
  {
    kind: 'none',
    label: 'Digital / points only',
    hint: 'No on-chain deposit (tickets, roles, etc.)',
    needsMint: false,
    needsOwlUnits: false,
    allowTreasuryFunded: false,
  },
  {
    kind: 'owl_spl',
    label: 'OWL tokens',
    hint: 'Deposit OWL to marketplace escrow, or fund from treasury for points sales',
    needsMint: false,
    needsOwlUnits: true,
    allowTreasuryFunded: true,
  },
  {
    kind: 'nft',
    label: 'NFT',
    hint: 'Deposit NFT to marketplace escrow wallet',
    needsMint: true,
    needsOwlUnits: false,
    allowTreasuryFunded: false,
  },
]

export function AdminDiscordShopClient() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && wallet && getCachedAdmin(wallet) === true
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => (cachedTrue ? true : null))
  const [loading, setLoading] = useState(() => !cachedTrue)

  const [items, setItems] = useState<DiscordMarketplaceShopItem[]>([])
  const [escrowWallet, setEscrowWallet] = useState<string | null>(null)
  const [paymentWallet, setPaymentWallet] = useState<string | null>(null)
  const [escrowOwlBalance, setEscrowOwlBalance] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)

  const [depositKind, setDepositKind] = useState<ShopDepositKind>('owl_spl')
  const [treasuryFunded, setTreasuryFunded] = useState(false)
  const [form, setForm] = useState({
    display_name: '',
    slug: '',
    asset_mint: '',
    owl_units: '10',
    price_amount: '',
    price_currency: 'POINTS' as ShopPriceCurrency,
    description: '',
  })

  const selectedDeposit = DEPOSIT_OPTIONS.find((d) => d.kind === depositKind) ?? DEPOSIT_OPTIONS[0]

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
    fetch(`/api/admin/check?wallet=${encodeURIComponent(addr)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const admin = data?.isAdmin === true
        setCachedAdmin(addr, admin, data?.role ?? null)
        setIsAdmin(admin)
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setLoading(false))
  }, [connected, publicKey])

  const load = useCallback(async () => {
    setListLoading(true)
    try {
      const res = await fetch('/api/admin/discord-shop/items', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setItems(Array.isArray(data.items) ? data.items : [])
        setEscrowWallet(data.escrow_wallet ?? null)
        setPaymentWallet(data.payment_wallet ?? null)
        setEscrowOwlBalance(Number(data.escrow_owl_balance ?? 0))
      }
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg('Copied to clipboard')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setErr('Could not copy')
    }
  }

  const submit = async () => {
    setErr(null)
    setMsg(null)
    const price = parseFloat(form.price_amount)
    if (!form.display_name.trim() || !Number.isFinite(price) || price <= 0) {
      setErr('Name and price are required')
      return
    }
    if (selectedDeposit.needsMint && !form.asset_mint.trim()) {
      setErr('NFT mint address is required')
      return
    }
    const owlUnits = parseFloat(form.owl_units)
    if (selectedDeposit.needsOwlUnits && !treasuryFunded && (!Number.isFinite(owlUnits) || owlUnits <= 0)) {
      setErr('OWL amount per sale is required')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/discord-shop/items', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          slug: form.slug.trim() || undefined,
          description: form.description.trim() || undefined,
          deposit_kind: depositKind,
          asset_mint: selectedDeposit.needsMint ? form.asset_mint.trim() : undefined,
          units_per_sale: selectedDeposit.needsOwlUnits ? owlUnits : 1,
          price_amount: price,
          price_currency: form.price_currency,
          treasury_funded: selectedDeposit.allowTreasuryFunded && treasuryFunded,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Create failed')
        return
      }
      setMsg(data.next_step ?? 'Listing created')
      setForm((f) => ({ ...f, display_name: '', slug: '', asset_mint: '', description: '' }))
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const verifyDeposit = async (id: string) => {
    setVerifyingId(id)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/discord-shop/items/${id}/verify-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Verify failed')
        return
      }
      setMsg('Listing is now live in Discord')
      await load()
    } finally {
      setVerifyingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Checking admin access…
      </div>
    )
  }

  if (!connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discord Shop</CardTitle>
          <CardDescription>Connect a founder wallet to manage marketplace listings.</CardDescription>
        </CardHeader>
        <CardContent>
          <WalletConnectButton />
        </CardContent>
      </Card>
    )
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>Full admin wallet required.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Admin
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Store className="h-6 w-6" />
          Discord Shop
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Marketplace wallets</CardTitle>
          <CardDescription>
            Inventory escrow (NFTs + OWL stock) is separate from raffle prize escrow. On-chain payments
            go to the payment wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Escrow (deposit NFTs / OWL here): </span>
            {escrowWallet ? (
              <button type="button" className="font-mono text-xs underline" onClick={() => void copy(escrowWallet)}>
                {escrowWallet}
              </button>
            ) : (
              <span className="text-amber-400">Set DISCORD_MARKETPLACE_ESCROW_SECRET_KEY</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Payment (SOL / OWL sales): </span>
            {paymentWallet ? (
              <button type="button" className="font-mono text-xs underline" onClick={() => void copy(paymentWallet)}>
                {paymentWallet}
              </button>
            ) : (
              <span className="text-amber-400">Set DISCORD_MARKETPLACE_PAYMENT_WALLET</span>
            )}
          </div>
          {escrowWallet ? (
            <p className="text-muted-foreground">Escrow OWL balance: {escrowOwlBalance.toLocaleString()} OWL</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add shop item</CardTitle>
          <CardDescription>Choose what you are listing, set the price, then deposit to escrow if needed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>What are you listing?</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {DEPOSIT_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => {
                    setDepositKind(opt.kind)
                    if (!opt.allowTreasuryFunded) setTreasuryFunded(false)
                  }}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    depositKind === opt.kind
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedDeposit.allowTreasuryFunded ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={treasuryFunded}
                onChange={(e) => setTreasuryFunded(e.target.checked)}
              />
              Fund OWL from treasury on purchase (no escrow deposit)
            </label>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="10 OWL Bundle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug (optional)</Label>
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="owl-10"
              />
            </div>
          </div>

          {selectedDeposit.needsMint ? (
            <div className="space-y-2">
              <Label htmlFor="mint">NFT mint / asset address</Label>
              <Input
                id="mint"
                value={form.asset_mint}
                onChange={(e) => setForm((f) => ({ ...f, asset_mint: e.target.value }))}
                placeholder="So111…"
                className="font-mono text-xs"
              />
            </div>
          ) : null}

          {selectedDeposit.needsOwlUnits && !treasuryFunded ? (
            <div className="space-y-2">
              <Label htmlFor="owl_units">OWL per sale (deposit this much to escrow)</Label>
              <Input
                id="owl_units"
                type="number"
                min="0"
                step="any"
                value={form.owl_units}
                onChange={(e) => setForm((f) => ({ ...f, owl_units: e.target.value }))}
              />
            </div>
          ) : null}

          {selectedDeposit.needsOwlUnits && treasuryFunded ? (
            <div className="space-y-2">
              <Label htmlFor="owl_units_t">OWL delivered per purchase</Label>
              <Input
                id="owl_units_t"
                type="number"
                min="0"
                step="any"
                value={form.owl_units}
                onChange={(e) => setForm((f) => ({ ...f, owl_units: e.target.value }))}
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="any"
                value={form.price_amount}
                onChange={(e) => setForm((f) => ({ ...f, price_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Price currency</Label>
              <select
                id="currency"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.price_currency}
                onChange={(e) => setForm((f) => ({ ...f, price_currency: e.target.value as ShopPriceCurrency }))}
              >
                <option value="POINTS">Points</option>
                <option value="SOL">SOL</option>
                <option value="OWL">OWL</option>
              </select>
            </div>
          </div>

          <Button type="button" disabled={submitting} onClick={() => void submit()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create listing
          </Button>

          {msg ? (
            <p className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {msg}
            </p>
          ) : null}
          {err ? <p className="text-sm text-red-400">{err}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listings</CardTitle>
          <CardDescription>Pending items need a deposit + verify before Discord users can buy.</CardDescription>
        </CardHeader>
        <CardContent>
          {listLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="font-medium">
                    {item.display_name}{' '}
                    <span className="text-muted-foreground">({item.slug})</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {item.deposit_kind} · {item.price_amount} {item.price_currency} · {item.status}
                    {item.treasury_funded ? ' · treasury-funded' : ''}
                  </div>
                  {item.status === 'pending_deposit' ? (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      disabled={verifyingId === item.id}
                      onClick={() => void verifyDeposit(item.id)}
                    >
                      {verifyingId === item.id ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : null}
                      Verify deposit & publish
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

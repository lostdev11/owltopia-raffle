'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, Gift, Loader2, RefreshCw, RotateCcw, Search, Wrench } from 'lucide-react'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import {
  GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP,
  GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_DEFAULT,
} from '@/lib/gen2-presale/admin-gift-limits'

type Stats = {
  presale_supply: number
  sold: number
  remaining: number
  percent_sold: number
  unit_price_usdc: number
  presale_live: boolean
  presale_settings_updated_at?: string
  presale_settings_updated_by?: string | null
}

type Balance = {
  wallet: string
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
}

type PurchaseRow = {
  id: string
  wallet: string
  quantity: number
  tx_signature: string
  created_at: string
  total_lamports: string | number
}

type WalletPurchaseGroup = {
  wallet: string
  totalQuantity: number
  purchaseCount: number
  latestCreatedAt: string
  purchases: PurchaseRow[]
}

export default function AdminGen2PresalePage() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const { signIn, signingIn, error: signInErr } = useSiwsSignIn()

  const [stats, setStats] = useState<Stats | null>(null)
  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [searchWallet, setSearchWallet] = useState('')
  const [balance, setBalance] = useState<Balance | null>(null)
  const [giftQty, setGiftQty] = useState(1)
  const [refundQty, setRefundQty] = useState(1)
  const [refundTxSig, setRefundTxSig] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [giftMsg, setGiftMsg] = useState<string | null>(null)
  const [refundMsg, setRefundMsg] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [backfillPageSize, setBackfillPageSize] = useState(100)
  const [backfillMaxPages, setBackfillMaxPages] = useState(8)
  const [backfillLoading, setBackfillLoading] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [backfillResult, setBackfillResult] = useState<Record<string, unknown> | null>(null)
  const [repairSig, setRepairSig] = useState('')
  const [repairLoading, setRepairLoading] = useState(false)
  const [repairMsg, setRepairMsg] = useState<string | null>(null)
  const [repairResult, setRepairResult] = useState<Record<string, unknown> | null>(null)

  const groupedPurchases = useMemo<WalletPurchaseGroup[]>(() => {
    const groups = new Map<string, WalletPurchaseGroup>()
    for (const purchase of purchases) {
      const existing = groups.get(purchase.wallet)
      if (existing) {
        existing.purchases.push(purchase)
        existing.purchaseCount += 1
        existing.totalQuantity += purchase.quantity
      } else {
        groups.set(purchase.wallet, {
          wallet: purchase.wallet,
          totalQuantity: purchase.quantity,
          purchaseCount: 1,
          latestCreatedAt: purchase.created_at,
          purchases: [purchase],
        })
      }
    }
    return Array.from(groups.values())
  }, [purchases])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/admin/gen2-presale/stats', { credentials: 'include' }),
        fetch('/api/admin/gen2-presale/purchases?limit=40', { credentials: 'include' }),
      ])
      if (sRes.status === 401) {
        setError('Sign in required — use the Sign in button below after connecting your wallet.')
        setStats(null)
        setPurchases([])
        return
      }
      if (!sRes.ok) {
        const j = await sRes.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error || 'Not authorized or failed to load stats.')
      }
      if (!pRes.ok) {
        const j = await pRes.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error || 'Failed to load purchases.')
      }
      const sJson = (await sRes.json()) as Stats
      const pJson = (await pRes.json()) as { purchases?: PurchaseRow[] }
      setStats(sJson)
      setPurchases(pJson.purchases ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connected && wallet) void load()
    else {
      setLoading(false)
      setStats(null)
      setPurchases([])
    }
  }, [connected, wallet, load])

  const searchBalance = async () => {
    setError(null)
    setBalance(null)
    const w = searchWallet.trim()
    if (!w) return
    try {
      const res = await fetch(`/api/admin/gen2-presale/wallet?wallet=${encodeURIComponent(w)}`, {
        credentials: 'include',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error || 'Lookup failed')
      }
      const j = (await res.json()) as { balance: Balance }
      setBalance(j.balance)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    }
  }

  const setPresaleLiveFlag = async (next: boolean) => {
    setSettingsSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/gen2-presale/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_live: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((j as { error?: string }).error || 'Could not update presale status')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSettingsSaving(false)
    }
  }

  const backfillFromChain = async () => {
    setBackfillMsg(null)
    setBackfillResult(null)
    setBackfillLoading(true)
    const controller = new AbortController()
    const tid = window.setTimeout(() => controller.abort(), 280_000)
    try {
      const res = await fetch('/api/admin/gen2-presale/backfill-from-chain', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          pageSize: Math.min(1000, Math.max(1, Math.floor(backfillPageSize) || 100)),
          maxPages: Math.min(80, Math.max(1, Math.floor(backfillMaxPages) || 8)),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        throw new Error((j.error as string | undefined) || 'Backfill failed')
      }
      setBackfillResult(j)
      const s = (j as { summary?: Record<string, number> }).summary ?? {}
      const ins = typeof s.inserted === 'number' ? s.inserted : 0
      const rep = typeof s.existing_repaired_quantity === 'number' ? s.existing_repaired_quantity : 0
      const def =
        typeof s.deferred_past_verification_cap === 'number' ? s.deferred_past_verification_cap : 0
      const cap = (j as { limits?: { max_deep_verifications?: number } }).limits?.max_deep_verifications ?? 150
      let msg = `Backfill complete. Recorded ${ins} new purchase(s). Repaired ${rep} existing row(s) with missing credits.`
      if (def > 0) {
        msg += ` ${def} signature(s) not processed yet — run again (max ${cap} deep checks per run).`
      }
      setBackfillMsg(msg)
      void load()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setBackfillMsg('Backfill timed out — lower max pages or page size and try again.')
      } else {
        setBackfillMsg(e instanceof Error ? e.message : 'Backfill failed')
      }
    } finally {
      window.clearTimeout(tid)
      setBackfillLoading(false)
    }
  }

  const repairPurchaseQuantity = async () => {
    const sig = repairSig.trim()
    setRepairMsg(null)
    setRepairResult(null)
    if (!sig) {
      setRepairMsg('Paste a transaction signature first.')
      return
    }
    setRepairLoading(true)
    try {
      const res = await fetch('/api/admin/gen2-presale/repair-purchase-quantity', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txSignature: sig }),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        throw new Error((j.error as string | undefined) || 'Repair failed')
      }
      setRepairResult(j)
      const unchanged = j.unchanged === true
      const rpc = j.rpc as { previous_quantity?: number; quantity?: number; delta?: number } | undefined
      setRepairMsg(
        unchanged
          ? 'Already correct — no database changes.'
          : `Updated quantity ${rpc?.previous_quantity ?? '?'} → ${rpc?.quantity ?? j.resolved_quantity ?? '?'}` +
              (rpc?.delta != null ? ` (Δ ${rpc.delta > 0 ? '+' : ''}${rpc.delta})` : '') +
              '.'
      )
      void load()
    } catch (e) {
      setRepairMsg(e instanceof Error ? e.message : 'Repair failed')
    } finally {
      setRepairLoading(false)
    }
  }

  const gift = async () => {
    setGiftMsg(null)
    const w = searchWallet.trim()
    if (!w) {
      setGiftMsg('Enter a wallet address first.')
      return
    }
    try {
      const res = await fetch('/api/admin/gen2-presale/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ wallet: w, quantity: giftQty }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((j as { error?: string }).error || 'Gift failed')
      setBalance((j as { balance?: Balance }).balance ?? null)
      setGiftMsg('Gift applied.')
      void load()
    } catch (e) {
      setGiftMsg(e instanceof Error ? e.message : 'Gift failed')
    }
  }

  const refund = async () => {
    setRefundMsg(null)
    const w = searchWallet.trim()
    if (!w) {
      setRefundMsg('Enter a wallet address first.')
      return
    }
    if (!Number.isFinite(refundQty) || refundQty < 1) {
      setRefundMsg('Set refund quantity to at least 1.')
      return
    }
    try {
      const res = await fetch('/api/admin/gen2-presale/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: w,
          quantity: refundQty,
          purchaseTxSignature: null,
          refundTxSignature: refundTxSig.trim() || null,
          reason: refundReason.trim() || null,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: { error?: string; max_refundable?: number; refunded_quantity?: number }
        balance?: Balance
        result?: { refunded_quantity?: number }
      }
      if (!res.ok) {
        const detailError = j.detail?.error
        if (detailError === 'refund_exceeds_refundable_purchased_mints') {
          throw new Error(`Refund too high. Max refundable now: ${j.detail?.max_refundable ?? 0}.`)
        }
        throw new Error(j.error || detailError || 'Refund failed')
      }
      const refundedQty = j.result?.refunded_quantity ?? j.detail?.refunded_quantity ?? refundQty
      setBalance(j.balance ?? null)
      setRefundMsg(`Refund applied. Deducted ${refundedQty} purchased credit(s).`)
      void load()
    } catch (e) {
      setRefundMsg(e instanceof Error ? e.message : 'Refund failed')
    }
  }

  if (!connected) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <p className="mb-4 text-muted-foreground">Connect your wallet to access Gen2 presale admin.</p>
        <WalletConnectButton />
      </main>
    )
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" /> Owl Vision
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Gen2 Presale Admin</h1>
      </div>

      <Card className="mb-6 border-amber-500/40 bg-amber-950/20">
        <CardHeader>
          <CardTitle className="text-lg">Access</CardTitle>
          <CardDescription>
            Requires Sign-In with Solana (session cookie). Full admins from the <code className="text-xs">admins</code>{' '}
            table are allowed. Alternatively, add comma-separated wallets to server env{' '}
            <code className="text-xs">ADMIN_WALLETS=...</code> for presale operators (no deploy yet? leave TODO in env).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void signIn()} disabled={signingIn}>
            {signingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sign in for admin session
          </Button>
          {signInErr && <p className="text-sm text-destructive">{signInErr}</p>}
        </CardContent>
      </Card>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      ) : stats ? (
        <div className="space-y-8">
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>Presale live</CardTitle>
              <CardDescription>
                Controls whether visitors can start new purchases on{' '}
                <code className="text-xs">/gen2-presale</code>. Requires SQL migration{' '}
                <code className="text-xs">094_gen2_presale_settings</code>. Confirm API still records in-flight
                payments when off.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{stats.presale_live ? 'On — purchases enabled' : 'Off — paused'}</p>
                  {stats.presale_settings_updated_at && (
                    <p className="text-xs text-muted-foreground">
                      Last changed {new Date(stats.presale_settings_updated_at).toLocaleString()}
                      {stats.presale_settings_updated_by
                        ? ` · ${stats.presale_settings_updated_by.slice(0, 8)}…`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {settingsSaving ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden /> : null}
                  <Switch
                    id="gen2-presale-live"
                    ariaLabel="Turn Gen2 presale purchases on or off"
                    checked={stats.presale_live}
                    disabled={settingsSaving}
                    onCheckedChange={(c) => void setPresaleLiveFlag(c)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Supply</CardTitle>
              <CardDescription>Sold vs remaining presale spots.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Supply</span>{' '}
                <span className="font-mono font-semibold">{stats.presale_supply}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Sold</span>{' '}
                <span className="font-mono font-semibold">{stats.sold}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Remaining</span>{' '}
                <span className="font-mono font-semibold">{stats.remaining}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Unit (USDC)</span>{' '}
                <span className="font-mono font-semibold">{stats.unit_price_usdc}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backfill from chain</CardTitle>
              <CardDescription>
                Paginates <strong>founder A</strong> and <strong>founder B</strong>, merges unique signatures (newest
                first). <strong>Inserts</strong> missing payments and <strong>re-checks</strong> signatures already in
                the database so under-reported quantities from an old backfill can be repaired. Up to{' '}
                <strong>150</strong> signatures fully verified per run — run again if deferred remain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="bf-page">Page size (per RPC call, max 1000)</Label>
                  <Input
                    id="bf-page"
                    type="number"
                    min={1}
                    max={1000}
                    value={backfillPageSize}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      setBackfillPageSize(Math.min(1000, Math.max(1, Math.floor(n))))
                    }}
                    className="w-28 min-h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bf-pages">Max pages</Label>
                  <Input
                    id="bf-pages"
                    type="number"
                    min={1}
                    max={80}
                    value={backfillMaxPages}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      setBackfillMaxPages(Math.min(80, Math.max(1, Math.floor(n))))
                    }}
                    className="w-24 min-h-11"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={backfillLoading}
                  onClick={() => void backfillFromChain()}
                >
                  {backfillLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Run backfill
                </Button>
              </div>
              {backfillMsg && <p className="text-sm text-muted-foreground">{backfillMsg}</p>}
              {backfillResult != null ? (
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                  {JSON.stringify(backfillResult, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Repair purchase quantity</CardTitle>
              <CardDescription>
                If backfill recorded <strong>too few spots</strong> for a signature (known bug: quantity stopped at 1),
                paste the payment <strong>transaction signature</strong> here. The server re-reads the tx from chain,
                infers the correct spot count, updates the purchase row, and adds the difference to the buyer&apos;s{' '}
                <code className="text-xs">purchased_mints</code>. Requires migration{' '}
                <code className="text-xs">098_gen2_presale_repair_purchase_quantity.sql</code> on Supabase. Run once per
                bad signature.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="repair-sig">Transaction signature</Label>
                  <Input
                    id="repair-sig"
                    value={repairSig}
                    onChange={(e) => setRepairSig(e.target.value)}
                    placeholder="Base58 signature"
                    className="min-h-11 font-mono text-xs"
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={repairLoading}
                  className="min-h-11 shrink-0 touch-manipulation"
                  onClick={() => void repairPurchaseQuantity()}
                >
                  {repairLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 h-4 w-4" />
                  )}
                  Repair from chain
                </Button>
              </div>
              {repairMsg && <p className="text-sm text-muted-foreground">{repairMsg}</p>}
              {repairResult != null ? (
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
                  {JSON.stringify(repairResult, null, 2)}
                </pre>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Wallet lookup & gifts</CardTitle>
              <CardDescription>
                Search balances and add gifted Gen2 mint credits (bonus allocations). Each gift is written to an audit
                table with your signed-in admin wallet as actor. Server rate limits apply; per-request max defaults to{' '}
                {GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_DEFAULT} (raise up to {GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP} via{' '}
                <code className="text-xs">GEN2_PRESALE_ADMIN_MAX_GIFT_QTY</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="gw">Wallet</Label>
                  <Input
                    id="gw"
                    value={searchWallet}
                    onChange={(e) => setSearchWallet(e.target.value)}
                    placeholder="Solana address"
                    className="font-mono text-xs"
                  />
                </div>
                <Button type="button" variant="secondary" onClick={() => void searchBalance()}>
                  <Search className="mr-2 h-4 w-4" /> Lookup
                </Button>
              </div>
              {balance && (
                <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                  <p className="font-mono text-xs text-muted-foreground">{balance.wallet}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground">Purchased</p>
                      <p className="font-semibold">{balance.purchased_mints}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Gifted</p>
                      <p className="font-semibold">{balance.gifted_mints}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Used</p>
                      <p className="font-semibold">{balance.used_mints}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Available</p>
                      <p className="font-semibold">{balance.available_mints}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="gq">Gift quantity</Label>
                  <Input
                    id="gq"
                    type="number"
                    min={1}
                    max={GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP}
                    value={giftQty}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      setGiftQty(
                        Math.min(
                          GEN2_PRESALE_ADMIN_MAX_GIFT_QTY_ABSOLUTE_CAP,
                          Math.max(1, Math.floor(n))
                        )
                      )
                    }}
                    className="w-28"
                  />
                </div>
                <Button type="button" onClick={() => void gift()}>
                  <Gift className="mr-2 h-4 w-4" /> Add gifted credits
                </Button>
              </div>
              {giftMsg && <p className="text-sm text-muted-foreground">{giftMsg}</p>}

              <div className="border-t pt-4">
                <p className="mb-2 text-sm font-medium">Refund purchased credits</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  After sending funds back, deduct credits from this wallet. Paste the buyer wallet (or tap a grouped
                  wallet below), set quantity, then apply refund.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="refund-qty">Refund quantity</Label>
                    <Input
                      id="refund-qty"
                      type="number"
                      min={1}
                      max={500}
                      value={refundQty}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        setRefundQty(Math.min(500, Math.max(1, Math.floor(n))))
                      }}
                      className="w-28 min-h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="refund-tx-sig">Your refund tx signature (optional)</Label>
                    <Input
                      id="refund-tx-sig"
                      value={refundTxSig}
                      onChange={(e) => setRefundTxSig(e.target.value)}
                      placeholder="Tx you sent back to buyer"
                      className="min-h-11 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="refund-reason">Reason (optional)</Label>
                    <Input
                      id="refund-reason"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="duplicate charge / customer support note"
                      className="min-h-11"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Button type="button" variant="destructive" className="min-h-11" onClick={() => void refund()}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Apply refund deduction
                  </Button>
                </div>
                {refundMsg && <p className="mt-2 text-sm text-muted-foreground">{refundMsg}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent purchases</CardTitle>
              <CardDescription>
                Latest confirmed presale transactions grouped by wallet for quicker multi-purchase review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupedPurchases.map((group) => (
                <div key={group.wallet} className="rounded-lg border bg-muted/30 p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{group.wallet}</p>
                      <p className="text-xs text-muted-foreground">
                        Last purchase {new Date(group.latestCreatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs touch-manipulation"
                        onClick={() => {
                          setSearchWallet(group.wallet)
                          setBalance(null)
                        }}
                      >
                        Use wallet for refund
                      </Button>
                      <span className="rounded-md border bg-background px-2 py-1">
                        Txns: <strong>{group.purchaseCount}</strong>
                      </span>
                      <span className="rounded-md border bg-background px-2 py-1">
                        Qty: <strong>{group.totalQuantity}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2 pr-4">When</th>
                          <th className="py-2 pr-4">Qty</th>
                          <th className="py-2">Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.purchases.map((p) => (
                          <tr key={p.id} className="border-b border-border/50">
                            <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                              {new Date(p.created_at).toLocaleString()}
                            </td>
                            <td className="py-2 pr-4">{p.quantity}</td>
                            <td className="max-w-[140px] truncate py-2 font-mono text-xs">
                              <a
                                className="text-primary underline"
                                href={`https://solscan.io/tx/${p.tx_signature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {p.tx_signature.slice(0, 8)}…
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {groupedPurchases.length === 0 && <p className="py-4 text-muted-foreground">No purchases yet.</p>}
            </CardContent>
          </Card>
        </div>
      ) : (
        !error && <p className="text-muted-foreground">No data.</p>
      )}
    </main>
  )
}

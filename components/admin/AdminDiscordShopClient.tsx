'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, CheckCircle2, Copy, Loader2, Store } from 'lucide-react'
import { PublicKey } from '@solana/web3.js'

import { WalletConnectButton } from '@/components/WalletConnectButton'
import { WalletNftPicker } from '@/components/WalletNftPicker'
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
import { slugifyShopItemSlug } from '@/lib/db/discord-marketplace-shop-items'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import {
  walletNftCollectionDisplayLabel,
  walletNftMintMatches,
} from '@/lib/raffles/wallet-nft-picker'
import { depositOwlToMarketplaceEscrowFromWallet } from '@/lib/solana/deposit-owl-to-marketplace-escrow'
import { depositPrizeNftToEscrowFromWallet } from '@/lib/solana/deposit-prize-nft-to-escrow-wallet'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { minimalWalletNftForEscrowTransfer } from '@/lib/solana/wallet-tokens'
import { fetchWalletNftsWithRetry } from '@/lib/solana/fetch-wallet-nfts-api'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

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
  const { connection } = useConnection()
  const { publicKey, connected, wallet } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const walletAddr = publicKey?.toBase58() ?? ''
  const cachedTrue = typeof window !== 'undefined' && walletAddr && getCachedAdmin(walletAddr) === true
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
  const [registeringCommands, setRegisteringCommands] = useState(false)

  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [loadingWalletNfts, setLoadingWalletNfts] = useState(false)
  const [walletNftsError, setWalletNftsError] = useState<string | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [selectedShopNft, setSelectedShopNft] = useState<WalletNft | null>(null)

  const [walletOwlUi, setWalletOwlUi] = useState<number | null>(null)
  const [walletOwlMint, setWalletOwlMint] = useState<string | null>(null)
  const [loadingWalletOwl, setLoadingWalletOwl] = useState(false)
  const [walletOwlError, setWalletOwlError] = useState<string | null>(null)
  const [walletOwlRecognized, setWalletOwlRecognized] = useState(false)

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
    if (depositKind !== 'nft') {
      setWalletNfts(null)
      setWalletNftsError(null)
      setNftSearchQuery('')
      setSelectedShopNft(null)
    }
    if (depositKind !== 'owl_spl') {
      setWalletOwlUi(null)
      setWalletOwlMint(null)
      setWalletOwlError(null)
      setWalletOwlRecognized(false)
    }
  }, [depositKind])

  const loadWalletOwl = useCallback(async () => {
    if (!publicKey) return
    setLoadingWalletOwl(true)
    setWalletOwlError(null)
    setWalletOwlRecognized(false)
    try {
      if (!isOwlEnabled()) {
        setWalletOwlUi(null)
        setWalletOwlMint(null)
        setWalletOwlError('OWL mint is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS).')
        return
      }
      const owl = getTokenInfo('OWL')
      const mintStr = owl.mintAddress?.trim()
      if (!mintStr) {
        setWalletOwlError('OWL mint address missing.')
        return
      }
      const mintPk = new PublicKey(mintStr)
      const res = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk }, 'confirmed')
      let totalRaw = 0n
      for (const { account } of res.value) {
        const info = account.data?.parsed?.info as
          | { tokenAmount?: { amount?: string } }
          | undefined
        const amtStr = info?.tokenAmount?.amount
        if (typeof amtStr === 'string' && /^[0-9]+$/.test(amtStr)) {
          totalRaw += BigInt(amtStr)
        }
      }
      const ui = Number(totalRaw) / 10 ** owl.decimals
      setWalletOwlUi(ui)
      setWalletOwlMint(mintStr)
      setWalletOwlRecognized(true)
      if (ui > 0) {
        setForm((f) => ({
          ...f,
          display_name: f.display_name.trim()
            ? f.display_name
            : `${ui % 1 === 0 ? ui.toLocaleString() : ui.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL`,
          slug: f.slug.trim() || slugifyShopItemSlug(`owl-${Math.trunc(ui) || 'bundle'}`),
        }))
      }
    } catch (e) {
      console.error('loadWalletOwl:', e)
      setWalletOwlError(e instanceof Error ? e.message : 'Failed to read OWL balance')
      setWalletOwlUi(null)
      setWalletOwlRecognized(false)
    } finally {
      setLoadingWalletOwl(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    if (depositKind === 'owl_spl' && connected && publicKey) {
      void loadWalletOwl()
    }
  }, [depositKind, connected, publicKey, loadWalletOwl])

  const handleShopNftSelect = useCallback((nft: WalletNft) => {
    setSelectedShopNft(nft)
    setForm((f) => {
      const name = nft.name?.trim() || f.display_name
      const slug = f.slug.trim() || (name ? slugifyShopItemSlug(name) : '')
      return {
        ...f,
        asset_mint: nft.mint,
        display_name: f.display_name.trim() ? f.display_name : name || f.display_name,
        slug,
      }
    })
  }, [])

  const handleShopNftMintInputChange = useCallback(
    (mint: string) => {
      setForm((f) => ({ ...f, asset_mint: mint }))
      const trimmed = mint.trim()
      if (!trimmed) {
        setSelectedShopNft(null)
        return
      }
      const match = walletNfts?.find((nft) => walletNftMintMatches(nft.mint, trimmed))
      if (match) {
        setSelectedShopNft(match)
        setForm((f) => ({
          ...f,
          asset_mint: match.mint,
          display_name: f.display_name.trim() ? f.display_name : match.name?.trim() || f.display_name,
          slug: f.slug.trim() || slugifyShopItemSlug(match.name ?? match.mint),
        }))
      } else {
        setSelectedShopNft(null)
      }
    },
    [walletNfts]
  )

  const loadWalletNfts = useCallback(async () => {
    if (!publicKey) return
    setLoadingWalletNfts(true)
    setWalletNftsError(null)
    const walletAddr = publicKey.toBase58()
    try {
      const [apiResult, escrowRes] = await Promise.all([
        fetchWalletNftsWithRetry(walletAddr),
        fetch(`/api/wallet/escrowed-nft-mints?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        }),
      ])
      let nfts: WalletNft[] = apiResult.nfts
      if (nfts.length === 0 || apiResult.res?.status === 503) {
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
      setSelectedShopNft(null)
      setForm((f) => ({ ...f, asset_mint: '' }))
    } catch (e) {
      console.error('loadWalletNfts:', e)
      setWalletNftsError(e instanceof Error ? e.message : 'Failed to load wallet NFTs')
      setWalletNfts(null)
    } finally {
      setLoadingWalletNfts(false)
    }
  }, [connection, publicKey])

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

  const registerSlashCommands = async () => {
    setRegisteringCommands(true)
    setErr(null)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/discord/register-commands', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg = typeof data.error === 'string' ? data.error : 'Could not register Discord commands'
        const detail =
          typeof data.detail === 'string'
            ? data.detail
            : data.detail != null
              ? JSON.stringify(data.detail).slice(0, 400)
              : ''
        setErr(detail ? `${errMsg}: ${detail}` : errMsg)
        return
      }
      const names = Array.isArray(data.command_names) ? data.command_names.join(', ') : 'owltopia-shop'
      const note = typeof data.note === 'string' ? data.note : ''
      setMsg(`Slash commands registered (${names}). ${note} Try typing /owltopia-shop in Discord.`)
    } catch {
      setErr('Network error registering Discord commands')
    } finally {
      setRegisteringCommands(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg('Copied to clipboard')
      setTimeout(() => setMsg(null), 2000)
    } catch {
      setErr('Could not copy')
    }
  }

  const fundAndPublishItem = useCallback(
    async (item: DiscordMarketplaceShopItem): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!publicKey || !escrowWallet) {
        return { ok: false, error: 'Connect wallet and ensure marketplace escrow is configured.' }
      }
      if (item.status !== 'pending_deposit') {
        return { ok: true }
      }

      let depositTx: string | undefined

      if (item.deposit_kind === 'owl_spl') {
        setMsg(`Approve wallet: deposit ${item.units_per_sale} OWL to marketplace escrow…`)
        const dep = await depositOwlToMarketplaceEscrowFromWallet({
          connection,
          publicKey,
          sendTransaction,
          escrowAddress: escrowWallet,
          amountUi: item.units_per_sale,
        })
        if (!dep.ok) return dep
        depositTx = dep.signature
      } else if (item.deposit_kind === 'nft') {
        const mint = item.asset_mint?.trim()
        if (!mint) return { ok: false, error: 'Listing is missing NFT mint.' }
        const nftForDeposit: WalletNft =
          selectedShopNft && walletNftMintMatches(selectedShopNft.mint, mint)
            ? selectedShopNft
            : {
                ...minimalWalletNftForEscrowTransfer(mint),
                name: item.display_name,
              }
        setMsg('Approve wallet: transfer NFT to marketplace escrow…')
        const dep = await depositPrizeNftToEscrowFromWallet({
          connection,
          publicKey,
          sendTransaction,
          walletAdapter: wallet?.adapter ?? null,
          selectedNft: nftForDeposit,
          prizeMintAddress: mint,
          escrowAddress: escrowWallet,
          logCtx: {
            raffleId: item.id,
            nftMint: mint,
            transferAssetId: mint,
            escrowAddress: escrowWallet,
            fromWallet: publicKey.toBase58(),
          },
        })
        if (!dep.ok) return { ok: false, error: dep.error }
        depositTx = dep.signature
      } else {
        return { ok: false, error: 'This listing does not require a deposit.' }
      }

      setMsg('Confirming deposit on-chain…')
      const res = await fetch(`/api/admin/discord-shop/items/${item.id}/verify-deposit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deposit_tx: depositTx }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          ok: false,
          error:
            typeof data.error === 'string'
              ? `${data.error} Deposit tx: ${depositTx.slice(0, 12)}… — tap Deposit & publish after a few seconds if RPC lagged.`
              : 'Verify failed after deposit',
        }
      }
      return { ok: true }
    },
    [connection, escrowWallet, publicKey, selectedShopNft, sendTransaction, wallet?.adapter]
  )

  const submit = async () => {
    setErr(null)
    setMsg(null)
    const price = parseFloat(form.price_amount)
    if (!form.display_name.trim() || !Number.isFinite(price) || price <= 0) {
      setErr('Name and price are required')
      return
    }
    if (selectedDeposit.needsMint && !form.asset_mint.trim()) {
      setErr('NFT mint address is required — load wallet NFTs and select one')
      return
    }
    const owlUnits = parseFloat(form.owl_units)
    if (selectedDeposit.needsOwlUnits && !treasuryFunded && (!Number.isFinite(owlUnits) || owlUnits <= 0)) {
      setErr('OWL amount per sale is required')
      return
    }
    if (
      selectedDeposit.needsOwlUnits &&
      !treasuryFunded &&
      walletOwlUi != null &&
      Number.isFinite(owlUnits) &&
      owlUnits > walletOwlUi
    ) {
      setErr(
        `Wallet only has ${walletOwlUi.toLocaleString()} OWL. Lower the per-sale amount, or fund from treasury.`
      )
      return
    }
    if (
      (selectedDeposit.needsMint || (selectedDeposit.needsOwlUnits && !treasuryFunded)) &&
      !escrowWallet
    ) {
      setErr('Marketplace escrow is not configured (DISCORD_MARKETPLACE_ESCROW_SECRET_KEY).')
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

      const item = data.item as DiscordMarketplaceShopItem | undefined
      if (item?.status === 'pending_deposit') {
        const funded = await fundAndPublishItem(item)
        if (!funded.ok) {
          setErr(funded.error)
          setMsg('Listing saved as pending — fix the deposit, then tap Deposit & publish below.')
          await load()
          return
        }
        setMsg('Deposited to escrow and listing is live in Discord.')
      } else {
        setMsg(data.next_step ?? 'Listing created and live.')
      }

      setForm((f) => ({ ...f, display_name: '', slug: '', asset_mint: '', description: '' }))
      setSelectedShopNft(null)
      setNftSearchQuery('')
      await load()
      if (depositKind === 'owl_spl') void loadWalletOwl()
    } catch {
      setErr('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const depositAndPublish = async (item: DiscordMarketplaceShopItem) => {
    setVerifyingId(item.id)
    setErr(null)
    setMsg(null)
    try {
      const funded = await fundAndPublishItem(item)
      if (!funded.ok) {
        setErr(funded.error)
        return
      }
      setMsg('Deposited to escrow and listing is live in Discord.')
      await load()
      if (item.deposit_kind === 'owl_spl') void loadWalletOwl()
    } finally {
      setVerifyingId(null)
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
      <div className="flex flex-wrap items-center gap-3">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={registeringCommands}
          onClick={() => void registerSlashCommands()}
        >
          {registeringCommands ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Register Discord slash commands
        </Button>
      </div>
      {msg ? (
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {msg}
        </p>
      ) : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Marketplace wallets</CardTitle>
          <CardDescription>
            Inventory escrow (NFTs + OWL stock) is separate from raffle prize escrow. On-chain payments
            go to the payment wallet. SOL/OWL checkouts also charge a ~$1 platform fee (SOL) to{' '}
            <code className="text-xs">OWL_PLATFORM_FEE_TREASURY_WALLET</code>. New listings post a{' '}
            <strong>Quick buy</strong> button when the bot can write to the shop channel.
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
          <CardDescription>
            Create the listing, then your wallet will deposit OWL or the NFT into marketplace escrow and publish
            automatically (same idea as raffle prize escrow).
          </CardDescription>
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
            <div className="space-y-3">
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">Pick an NFT from your wallet</p>
                <p className="mt-0.5 text-muted-foreground">
                  Same flow as creating an NFT raffle — load your wallet, browse or search, then deposit the selected
                  NFT to marketplace escrow.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadWalletNfts()}
                disabled={loadingWalletNfts || !publicKey}
              >
                {loadingWalletNfts ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  'Load NFTs from wallet'
                )}
              </Button>
              {walletNftsError ? <p className="text-sm text-destructive">{walletNftsError}</p> : null}
              {walletNfts && walletNfts.length === 0 && !loadingWalletNfts ? (
                <p className="text-sm text-muted-foreground">
                  No NFTs found in this wallet (excluding prize-escrow NFTs). You can paste a mint address below.
                </p>
              ) : null}
              {walletNfts ? (
                <WalletNftPicker
                  nfts={walletNfts}
                  selectedMint={selectedShopNft?.mint ?? (form.asset_mint.trim() || null)}
                  onSelect={handleShopNftSelect}
                  searchQuery={nftSearchQuery}
                  onSearchQueryChange={setNftSearchQuery}
                  showMintPaste
                  mintInput={form.asset_mint}
                  onMintInputChange={handleShopNftMintInputChange}
                  searchInputId="shop-nft-search"
                  mintInputId="shop-nft-mint"
                />
              ) : null}
              {selectedShopNft || form.asset_mint.trim() ? (
                <p className="text-sm text-muted-foreground">
                  {selectedShopNft ? (
                    <>
                      Selected: <span className="text-foreground">{selectedShopNft.name ?? selectedShopNft.mint}</span>
                      {' · '}
                      {walletNftCollectionDisplayLabel(selectedShopNft)}
                    </>
                  ) : (
                    <>Mint: {form.asset_mint.trim()}</>
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedDeposit.needsOwlUnits ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">OWL in connected wallet</p>
                  <p className="text-xs text-muted-foreground">
                    Recognizes the configured OWL mint ({walletOwlMint ? `${walletOwlMint.slice(0, 4)}…${walletOwlMint.slice(-4)}` : '…'}).
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadWalletOwl()}
                  disabled={loadingWalletOwl || !publicKey}
                >
                  {loadingWalletOwl ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    'Refresh OWL'
                  )}
                </Button>
              </div>
              {walletOwlError ? <p className="text-sm text-destructive">{walletOwlError}</p> : null}
              {walletOwlRecognized && walletOwlUi != null ? (
                <p className="text-sm">
                  {walletOwlUi > 0 ? (
                    <>
                      Recognized <span className="font-semibold text-emerald-400">{walletOwlUi.toLocaleString()} OWL</span> in
                      this wallet.
                    </>
                  ) : (
                    <span className="text-amber-400">OWL mint recognized, but this wallet holds 0 OWL.</span>
                  )}
                </p>
              ) : null}
              {!treasuryFunded && walletOwlUi != null && walletOwlUi > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      owl_units: String(walletOwlUi),
                      display_name: f.display_name.trim()
                        ? f.display_name
                        : `${walletOwlUi % 1 === 0 ? walletOwlUi.toLocaleString() : walletOwlUi.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL`,
                    }))
                  }
                >
                  Use full wallet balance as units per sale
                </Button>
              ) : null}
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
              {walletOwlUi != null && Number(form.owl_units) > walletOwlUi ? (
                <p className="text-xs text-amber-400">
                  Amount exceeds wallet balance ({walletOwlUi.toLocaleString()} OWL).
                </p>
              ) : null}
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
            {selectedDeposit.needsMint || (selectedDeposit.needsOwlUnits && !treasuryFunded)
              ? 'Create, deposit & publish'
              : 'Create listing'}
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
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={verifyingId === item.id || !escrowWallet}
                        onClick={() => void depositAndPublish(item)}
                      >
                        {verifyingId === item.id ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : null}
                        Deposit & publish
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={verifyingId === item.id}
                        onClick={() => void verifyDeposit(item.id)}
                      >
                        Verify only
                      </Button>
                    </div>
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

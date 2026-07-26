'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { getTokenInfo } from '@/lib/tokens'
import type { AuctionDurationPreset } from '@/lib/auctions/constants'
import { WalletNftPicker } from '@/components/WalletNftPicker'
import { fetchWalletNftsWithRetry } from '@/lib/solana/fetch-wallet-nfts-api'
import {
  minimalWalletNftForEscrowTransfer,
  type WalletNft,
} from '@/lib/solana/wallet-tokens'
import {
  walletNftCollectionDisplayLabel,
  walletNftMintMatches,
} from '@/lib/raffles/wallet-nft-picker'
import { nftPrizeRaffleTitleFromWalletSelection } from '@/lib/raffles/nft-prize-raffle-title'

const DURATIONS: { key: AuctionDurationPreset; label: string }[] = [
  { key: '1h', label: '1 hour' },
  { key: '6h', label: '6 hours' },
  { key: '24h', label: '24 hours' },
  { key: '3d', label: '3 days' },
  { key: '7d', label: '7 days' },
]

export function CreateAuctionForm() {
  const router = useRouter()
  const { connection } = useConnection()
  const { publicKey, connected } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prizeType, setPrizeType] = useState<'nft' | 'sol' | 'usdc'>('nft')
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)
  const [nftMintInput, setNftMintInput] = useState('')
  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [loadingWalletAssets, setLoadingWalletAssets] = useState(false)
  const [walletAssetsError, setWalletAssetsError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [prizeAmount, setPrizeAmount] = useState('')
  const [bidCurrency, setBidCurrency] = useState<'SOL' | 'USDC'>('SOL')
  const [startPrice, setStartPrice] = useState('0.1')
  const [reservePrice, setReservePrice] = useState('')
  const [duration, setDuration] = useState<AuctionDurationPreset>('24h')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)

  const connectedWalletAddr = publicKey?.toBase58() ?? null
  useEffect(() => {
    // Wallet switched (or disconnected): the previous wallet's inventory must not stay selectable.
    setWalletNfts(null)
    setSelectedNft(null)
    setNftMintInput('')
    setNftSearchQuery('')
    setImageUrl(null)
    setWalletAssetsError(null)
  }, [connectedWalletAddr])

  const prizeNft = useMemo((): WalletNft | null => {
    if (selectedNft) return selectedNft
    const mint = nftMintInput.trim()
    if (!mint) return null
    const fromWallet = walletNfts?.find((nft) => walletNftMintMatches(nft.mint, mint))
    if (fromWallet) return fromWallet
    return minimalWalletNftForEscrowTransfer(mint)
  }, [selectedNft, nftMintInput, walletNfts])

  const handleNftPickerSelect = useCallback((nft: WalletNft) => {
    setSelectedNft(nft)
    setNftMintInput(nft.mint)
    setImageUrl(nft.image?.trim() ? nft.image.trim() : null)
    setTitle(nftPrizeRaffleTitleFromWalletSelection(nft.name, nft.mint))
  }, [])

  const handleNftMintInputChange = useCallback(
    (mint: string) => {
      setNftMintInput(mint)
      const trimmed = mint.trim()
      if (!trimmed) {
        setSelectedNft(null)
        setImageUrl(null)
        return
      }
      const match = walletNfts?.find((nft) => walletNftMintMatches(nft.mint, trimmed))
      if (match) {
        setSelectedNft(match)
        setImageUrl(match.image?.trim() ? match.image.trim() : null)
        setTitle(nftPrizeRaffleTitleFromWalletSelection(match.name, match.mint))
      } else {
        setSelectedNft(null)
        setImageUrl(null)
      }
    },
    [walletNfts]
  )

  const loadWalletAssets = async () => {
    if (!publicKey) return
    setLoadingWalletAssets(true)
    setWalletAssetsError(null)
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
      setNftMintInput('')
      setSelectedNft(null)
      setImageUrl(null)
    } catch (e) {
      console.error('Load wallet assets:', e)
      setWalletAssetsError(e instanceof Error ? e.message : 'Failed to load wallet assets')
      setWalletNfts(null)
    } finally {
      setLoadingWalletAssets(false)
    }
  }

  const effectiveBidCurrency =
    prizeType === 'sol' ? 'SOL' : prizeType === 'usdc' ? 'USDC' : bidCurrency

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!connected || !publicKey || !sendTransaction) {
      setError('Connect your wallet first.')
      return
    }

    const nftMint =
      prizeType === 'nft' ? (prizeNft?.mint.trim() || nftMintInput.trim()) : ''
    if (prizeType === 'nft' && !nftMint) {
      setError('Select an NFT from your wallet, or paste a mint / asset id.')
      return
    }

    const resolvedTitle =
      prizeType === 'nft' && prizeNft
        ? title.trim() || nftPrizeRaffleTitleFromWalletSelection(prizeNft.name, prizeNft.mint)
        : title.trim()
    if (resolvedTitle.length < 3) {
      setError('Enter a title (at least 3 characters).')
      return
    }

    setBusy(true)
    setError(null)
    setStep('Creating auction…')

    try {
      const createRes = await fetch('/api/auctions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: resolvedTitle,
          description: description || null,
          prize_type: prizeType,
          nft_mint_address: prizeType === 'nft' ? nftMint : null,
          nft_token_id:
            prizeType === 'nft' && prizeNft?.tokenAccount?.trim()
              ? prizeNft.tokenAccount.trim()
              : null,
          image_url: prizeType === 'nft' ? imageUrl || prizeNft?.image || null : null,
          prize_amount: prizeType === 'nft' ? null : Number(prizeAmount),
          bid_currency: effectiveBidCurrency,
          start_price: Number(startPrice),
          reserve_price: reservePrice.trim() ? Number(reservePrice) : null,
          duration,
          reserve_hidden: true,
        }),
      })
      const created = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        throw new Error(typeof created.error === 'string' ? created.error : 'Create failed')
      }

      const auction = created.auction as { id: string; slug: string }
      const prizeEscrow = created.prize_escrow as string | null
      if (!prizeEscrow) {
        throw new Error('Prize escrow is not configured on the server')
      }

      setStep('Depositing prize to escrow…')
      let depositTx: string | undefined

      if (prizeType === 'nft') {
        // NFT: try SPL transfer; Core / compressed may need manual deposit + verify.
        try {
          const mint = new PublicKey(nftMint)
          const escrowPk = new PublicKey(prizeEscrow)
          const fromAta = await getAssociatedTokenAddress(mint, publicKey)
          const toAta = await getAssociatedTokenAddress(mint, escrowPk)
          const tx = new Transaction()
          try {
            await getAccount(connection, toAta)
          } catch {
            tx.add(
              createAssociatedTokenAccountInstruction(
                publicKey,
                toAta,
                escrowPk,
                mint,
                TOKEN_PROGRAM_ID
              )
            )
          }
          tx.add(
            createTransferInstruction(fromAta, toAta, publicKey, BigInt(1), [], TOKEN_PROGRAM_ID)
          )
          const latest = await connection.getLatestBlockhash('confirmed')
          tx.recentBlockhash = latest.blockhash
          tx.feePayer = publicKey
          depositTx = await sendTransaction(tx, connection, { skipPreflight: false })
        } catch {
          // Fall through to verify-only — creator may deposit manually (Core/compressed).
          depositTx = undefined
        }
      } else if (prizeType === 'sol') {
        const amount = Number(prizeAmount)
        const lamports = Math.round(amount * LAMPORTS_PER_SOL)
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(prizeEscrow),
            lamports,
          })
        )
        const latest = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = latest.blockhash
        tx.feePayer = publicKey
        depositTx = await sendTransaction(tx, connection, { skipPreflight: false })
      } else {
        const amount = Number(prizeAmount)
        const usdc = getTokenInfo('USDC')
        if (!usdc.mintAddress) throw new Error('USDC not configured')
        const mint = new PublicKey(usdc.mintAddress)
        const escrowPk = new PublicKey(prizeEscrow)
        const fromAta = await getAssociatedTokenAddress(mint, publicKey)
        const toAta = await getAssociatedTokenAddress(mint, escrowPk)
        const raw = BigInt(Math.round(amount * 10 ** usdc.decimals))
        const tx = new Transaction()
        try {
          await getAccount(connection, toAta)
        } catch {
          tx.add(
            createAssociatedTokenAccountInstruction(publicKey, toAta, escrowPk, mint, TOKEN_PROGRAM_ID)
          )
        }
        tx.add(createTransferInstruction(fromAta, toAta, publicKey, raw, [], TOKEN_PROGRAM_ID))
        const latest = await connection.getLatestBlockhash('confirmed')
        tx.recentBlockhash = latest.blockhash
        tx.feePayer = publicKey
        depositTx = await sendTransaction(tx, connection, { skipPreflight: false })
      }

      setStep('Verifying deposit…')
      let verifyRes = await fetch(
        `/api/auctions/${encodeURIComponent(auction.id)}/verify-prize-deposit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deposit_tx: depositTx }),
        }
      )
      let verifyJson = await verifyRes.json().catch(() => ({}))
      if (!verifyRes.ok && prizeType === 'nft') {
        // Retry once after short wait for confirmation.
        await new Promise((r) => setTimeout(r, 2000))
        verifyRes = await fetch(
          `/api/auctions/${encodeURIComponent(auction.id)}/verify-prize-deposit`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deposit_tx: depositTx }),
          }
        )
        verifyJson = await verifyRes.json().catch(() => ({}))
      }
      if (!verifyRes.ok) {
        // Draft created — send user to detail to finish deposit.
        router.push(`/auctions/${encodeURIComponent(auction.slug)}?deposit=1`)
        throw new Error(
          typeof verifyJson.error === 'string'
            ? `${verifyJson.error} — auction saved as draft; finish deposit on the auction page.`
            : 'Deposit verify failed; finish on the auction page.'
        )
      }

      router.push(`/auctions/${encodeURIComponent(auction.slug)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required={prizeType !== 'nft'}
          minLength={3}
          className="min-h-[44px]"
          placeholder={prizeType === 'nft' ? 'Auto-filled when you pick an NFT' : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[44px]"
        />
      </div>

      <div className="space-y-2">
        <Label>Prize type</Label>
        <div className="flex flex-wrap gap-2">
          {(['nft', 'sol', 'usdc'] as const).map((t) => (
            <Button
              key={t}
              type="button"
              variant={prizeType === t ? 'default' : 'outline'}
              className="min-h-[44px] touch-manipulation"
              onClick={() => setPrizeType(t)}
            >
              {t.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {prizeType === 'nft' ? (
        <div id="nft-prize-section" className="space-y-3 rounded-md border bg-muted/30 p-4">
          <Label>NFT prize (from your wallet)</Label>
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Be careful when selecting an NFT
            </p>
            <p className="text-muted-foreground mt-0.5">
              Only choose an NFT you intend to auction. Staked or delegated NFTs cannot be used until
              you unstake them.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={loadWalletAssets}
            disabled={loadingWalletAssets || !publicKey}
            className="min-h-[44px] touch-manipulation"
          >
            {loadingWalletAssets ? 'Loading…' : 'Load NFTs from wallet'}
          </Button>
          {walletAssetsError ? (
            <p className="text-sm text-destructive">{walletAssetsError}</p>
          ) : null}
          {walletNfts && walletNfts.length === 0 && !loadingWalletAssets ? (
            <div className="text-sm text-muted-foreground space-y-1">
              <p>No NFTs found in this wallet.</p>
              <p>
                You can still paste a mint / asset id below if you know the address.
              </p>
            </div>
          ) : null}
          {walletNfts ? (
            <WalletNftPicker
              nfts={walletNfts}
              selectedMint={prizeNft?.mint ?? null}
              onSelect={handleNftPickerSelect}
              searchQuery={nftSearchQuery}
              onSearchQueryChange={setNftSearchQuery}
              showMintPaste
              mintInput={nftMintInput}
              onMintInputChange={handleNftMintInputChange}
            />
          ) : (
            <div className="space-y-1">
              <Label htmlFor="mint" className="text-xs">
                Or paste mint / asset id
              </Label>
              <Input
                id="mint"
                value={nftMintInput}
                onChange={(e) => handleNftMintInputChange(e.target.value)}
                className="min-h-[44px] font-mono text-sm touch-manipulation"
                placeholder="Paste from wallet or explorer"
              />
            </div>
          )}
          {prizeNft ? (
            <p className="text-sm text-muted-foreground">
              Selected: {prizeNft.name ?? prizeNft.mint}
              {' · '}
              {walletNftCollectionDisplayLabel(prizeNft)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Standard SPL NFTs deposit from this form. Core / compressed: create draft, then send to
            prize escrow and verify on the auction page.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="prizeAmount">Prize amount ({prizeType.toUpperCase()})</Label>
          <Input
            id="prizeAmount"
            type="number"
            step="any"
            min="0"
            value={prizeAmount}
            onChange={(e) => setPrizeAmount(e.target.value)}
            required
            className="min-h-[44px]"
          />
        </div>
      )}

      {prizeType === 'nft' ? (
        <div className="space-y-2">
          <Label>Bid currency</Label>
          <div className="flex gap-2">
            {(['SOL', 'USDC'] as const).map((c) => (
              <Button
                key={c}
                type="button"
                variant={bidCurrency === c ? 'default' : 'outline'}
                className="min-h-[44px] touch-manipulation"
                onClick={() => setBidCurrency(c)}
              >
                {c}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start">Start price ({effectiveBidCurrency})</Label>
          <Input
            id="start"
            type="number"
            step="any"
            min="0"
            value={startPrice}
            onChange={(e) => setStartPrice(e.target.value)}
            required
            className="min-h-[44px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reserve">Reserve (optional, hidden)</Label>
          <Input
            id="reserve"
            type="number"
            step="any"
            min="0"
            value={reservePrice}
            onChange={(e) => setReservePrice(e.target.value)}
            placeholder="Same or higher than start"
            className="min-h-[44px]"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Duration</Label>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Button
              key={d.key}
              type="button"
              variant={duration === d.key ? 'default' : 'outline'}
              className="min-h-[44px] touch-manipulation"
              onClick={() => setDuration(d.key)}
            >
              {d.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Soft close: bids in the last 5 minutes extend by 5 minutes (max 3 times).
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {step ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {step}
        </p>
      ) : null}

      <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto touch-manipulation">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Create & deposit prize
      </Button>
    </form>
  )
}

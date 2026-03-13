'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageUpload } from '@/components/ImageUpload'
import { NIGHT_MODE_PRESETS } from '@/lib/night-mode-presets'
import type { ThemeAccent } from '@/lib/types'
import type { PrizeType } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { localDateTimeToUtc, utcToLocalDateTime } from '@/lib/utils'
import { isOwlEnabled } from '@/lib/tokens'
import { getWalletNfts, getWalletTokens } from '@/lib/solana/wallet-tokens'
import type { WalletNft, WalletToken } from '@/lib/solana/wallet-tokens'

const LAMPORTS_PER_SOL = 1e9

export function CreateRaffleForm() {
  const router = useRouter()
  const { publicKey, connected, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const wallet = publicKey?.toBase58() ?? ''
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>('prime')
  const [startTime, setStartTime] = useState(() => new Date().toISOString().slice(0, 16))
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [prizeType, setPrizeType] = useState<PrizeType>('crypto')
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)
  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [walletTokens, setWalletTokens] = useState<WalletToken[] | null>(null)
  const [loadingWalletAssets, setLoadingWalletAssets] = useState(false)
  const [walletAssetsError, setWalletAssetsError] = useState<string | null>(null)
  const [creationFeeRequired, setCreationFeeRequired] = useState(false)
  const [creationFeeLamports, setCreationFeeLamports] = useState(0)
  const [creationFeeRecipient, setCreationFeeRecipient] = useState<string | null>(null)
  const [creationFeeSignature, setCreationFeeSignature] = useState<string | null>(null)
  const [creationFeeLoading, setCreationFeeLoading] = useState(false)
  const [creationFeeError, setCreationFeeError] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    let cancelled = false
    fetch('/api/config/creation-fee', { credentials: 'include' })
      .then((r) => (cancelled ? undefined : r.json()))
      .then((data: { creationFeeRequired?: boolean; creationFeeLamports?: number; creationFeeRecipient?: string | null }) => {
        if (cancelled) return
        setCreationFeeRequired(!!data?.creationFeeRequired)
        setCreationFeeLamports(Number(data?.creationFeeLamports) || 0)
        setCreationFeeRecipient(data?.creationFeeRecipient ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [connected])

  const payCreationFee = async () => {
    if (!publicKey || !creationFeeRecipient || creationFeeLamports <= 0) return
    setCreationFeeError(null)
    setCreationFeeLoading(true)
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(creationFeeRecipient),
          lamports: creationFeeLamports,
        })
      )
      const sig = await sendTransaction(tx, connection)
      await connection.confirmTransaction(sig, 'confirmed')
      setCreationFeeSignature(sig)
    } catch (e) {
      setCreationFeeError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setCreationFeeLoading(false)
    }
  }

  const loadWalletAssets = async () => {
    if (!publicKey) return
    setLoadingWalletAssets(true)
    setWalletAssetsError(null)
    try {
      const [nfts, tokens] = await Promise.all([
        getWalletNfts(connection, publicKey),
        getWalletTokens(connection, publicKey),
      ])
      setWalletNfts(nfts)
      setWalletTokens(tokens)
    } catch (e) {
      console.error('Load wallet assets:', e)
      setWalletAssetsError(e instanceof Error ? e.message : 'Failed to load wallet assets')
      setWalletNfts(null)
      setWalletTokens(null)
    } finally {
      setLoadingWalletAssets(false)
    }
  }

  const handlePresetSelect = (presetName: string) => {
    const preset = NIGHT_MODE_PRESETS.find(p => p.name === presetName)
    if (preset) {
      setSelectedPreset(presetName)
      setThemeAccent(preset.themeAccent)
      const presetEndTime = preset.getEndTime()
      // Convert the Date object (which is in local time) to datetime-local format
      const year = presetEndTime.getFullYear()
      const month = String(presetEndTime.getMonth() + 1).padStart(2, '0')
      const day = String(presetEndTime.getDate()).padStart(2, '0')
      const hours = String(presetEndTime.getHours()).padStart(2, '0')
      const minutes = String(presetEndTime.getMinutes()).padStart(2, '0')
      setEndTime(`${year}-${month}-${day}T${hours}:${minutes}`)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!connected || !publicKey) {
      alert('Please connect your wallet to create a raffle')
      return
    }

    if (creationFeeRequired && !creationFeeSignature) {
      alert('Please pay the raffle creation fee first, then submit the form.')
      return
    }

    // Validate 7-day maximum duration
    if (startTime && endTime) {
      const startDate = new Date(startTime)
      const endDate = new Date(endTime)
      const durationMs = endDate.getTime() - startDate.getTime()
      const durationDays = durationMs / (1000 * 60 * 60 * 24)
      
      if (durationDays > 7) {
        alert('Raffle duration cannot exceed 7 days')
        return
      }
    }

    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const maxTicketsValue = formData.get('max_tickets') as string
    const minTicketsValue = formData.get('min_tickets') as string
    const rankValue = formData.get('rank') as string
    const floorPriceValue = formData.get('floor_price') as string
    const currency = (formData.get('currency') as string) || 'SOL'
    const data: Record<string, unknown> = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      image_url: imageUrl || null,
      ticket_price: parseFloat(formData.get('ticket_price') as string),
      currency,
      max_tickets: maxTicketsValue ? parseInt(maxTicketsValue) : null,
      min_tickets: minTicketsValue ? parseInt(minTicketsValue) : null,
      rank: rankValue && rankValue.trim() ? rankValue.trim() : null,
      floor_price: floorPriceValue && floorPriceValue.trim() ? floorPriceValue.trim() : null,
      start_time: localDateTimeToUtc(startTime),
      end_time: localDateTimeToUtc(endTime),
      theme_accent: themeAccent,
      status: (formData.get('status') as string) || 'draft',
      slug: (formData.get('title') as string)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, ''),
      wallet_address: publicKey.toBase58(),
      prize_type: prizeType,
    }
    if (prizeType === 'nft') {
      if (!selectedNft) {
        alert('Please select an NFT from your wallet for an NFT raffle.')
        setLoading(false)
        return
      }
      data.nft_mint_address = selectedNft.mint
      data.nft_token_id = selectedNft.mint
      data.nft_metadata_uri = selectedNft.metadataUri ?? undefined
      data.nft_collection_name = selectedNft.collectionName ?? undefined
    } else {
      const prizeAmountValue = formData.get('prize_amount') as string
      data.prize_amount = prizeAmountValue ? parseFloat(prizeAmountValue) : 0
      data.prize_currency = formData.get('prize_currency') as string || currency
    }
    if (creationFeeSignature) {
      data.creation_fee_transaction_signature = creationFeeSignature
    }

    try {
      const response = await fetch('/api/raffles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (response.ok) {
        const raffle = await response.json()
        // NFT raffles must deposit prize to escrow before going live; redirect to deposit step
        if (raffle.prize_type === 'nft' && raffle.nft_mint_address) {
          router.push(`/raffles/${raffle.slug}?deposit=1`)
        } else {
          router.push(`/raffles/${raffle.slug}`)
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        const msg = errorData?.error ?? 'Error creating raffle'
        if (response.status === 401) {
          alert(`${msg} Sign in from your dashboard first, then try again.`)
          router.push('/dashboard')
        } else {
          alert(msg)
        }
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error creating raffle')
    } finally {
      setLoading(false)
    }
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  if (!connected || !publicKey) {
    return (
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardHeader>
          <CardTitle>Create a raffle</CardTitle>
          <CardDescription>
            Connect your wallet to create a raffle. You can create NFT or crypto prize raffles. Sign in from your dashboard first so we can save your raffle.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
      <CardHeader>
        <CardTitle>Raffle Details</CardTitle>
        <CardDescription>Fill in the details for your new raffle</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p>Admins: no creation fee. Non-admins: a creation fee is charged to list a raffle (see below).</p>
          <p><strong>Platform fee (deducted from every ticket sale):</strong> 3% for Owltopia (Owl NFT) holders, 6% for non-holders. The fee is taken from each ticket payment at purchase time.</p>
        </div>

        {creationFeeRequired && creationFeeLamports > 0 && creationFeeRecipient && (
          <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <Label>Raffle creation fee</Label>
            <p className="text-sm text-muted-foreground">
              A one-time fee of <strong>{(creationFeeLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL</strong> is required to create a raffle. Pay with your wallet below, then fill out and submit the form.
            </p>
            {creationFeeSignature ? (
              <p className="text-sm text-green-600 dark:text-green-400">Creation fee paid. You can submit the form.</p>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={payCreationFee}
                  disabled={creationFeeLoading || !connected}
                >
                  {creationFeeLoading ? 'Sending…' : `Pay ${(creationFeeLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`}
                </Button>
                {creationFeeError && (
                  <p className="text-sm text-destructive">{creationFeeError}</p>
                )}
              </>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" name="title" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <ImageUpload
            value={imageUrl}
            onChange={setImageUrl}
            label="Raffle / Prize Image"
            disabled={loading}
          />

          <div className="space-y-3">
            <Label>Prize type</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="prize_type"
                  checked={prizeType === 'crypto'}
                  onChange={() => {
                    setPrizeType('crypto')
                    setSelectedNft(null)
                  }}
                  className="rounded-full"
                />
                <span>Crypto (SOL, USDC, etc.)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="prize_type"
                  checked={prizeType === 'nft'}
                  onChange={() => setPrizeType('nft')}
                  className="rounded-full"
                />
                <span>NFT</span>
              </label>
            </div>
          </div>

          {prizeType === 'nft' && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <Label>NFT prize (from your wallet)</Label>
              <p className="text-xs text-muted-foreground">
                Load your wallet to see NFTs you can use as the raffle prize.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={loadWalletAssets}
                disabled={loadingWalletAssets || !publicKey}
              >
                {loadingWalletAssets ? 'Loading…' : 'Load NFTs & tokens from wallet'}
              </Button>
              {walletAssetsError && (
                <p className="text-sm text-destructive">{walletAssetsError}</p>
              )}
              {walletNfts && walletNfts.length === 0 && !loadingWalletAssets && (
                <p className="text-sm text-muted-foreground">No NFTs found in this wallet.</p>
              )}
              {walletNfts && walletNfts.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[280px] overflow-y-auto">
                  {walletNfts.map((nft) => (
                    <button
                      key={nft.tokenAccount}
                      type="button"
                      onClick={() => {
                        setSelectedNft(nft)
                        if (nft.image) setImageUrl(nft.image)
                      }}
                      className={`rounded-lg border-2 p-2 text-left transition-colors ${
                        selectedNft?.mint === nft.mint
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/50'
                      }`}
                    >
                      <div className="aspect-square rounded overflow-hidden bg-muted mb-2">
                        {nft.image ? (
                          <img
                            src={nft.image}
                            alt={nft.name ?? nft.mint}
                            className="w-full h-full object-cover"
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
                  ))}
                </div>
              )}
              {selectedNft && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Selected: {selectedNft.name ?? selectedNft.mint}
                  </p>
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">Wallet &amp; fees</p>
                    <p className="text-muted-foreground mt-0.5">
                      After you create this raffle, your wallet will be prompted to send this NFT to platform escrow on the next page. Listing fee: <strong>0 SOL</strong> — only network (gas) fees apply.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {prizeType === 'crypto' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prize_amount">Prize amount (optional)</Label>
                <Input
                  id="prize_amount"
                  name="prize_amount"
                  type="number"
                  step="0.000001"
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prize_currency">Prize currency</Label>
                <select
                  id="prize_currency"
                  name="prize_currency"
                  defaultValue="SOL"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm"
                >
                  <option value="SOL">SOL</option>
                  <option value="USDC">USDC</option>
                  {isOwlEnabled() && <option value="OWL">OWL</option>}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ticket_price">Ticket Price *</Label>
              <Input id="ticket_price" name="ticket_price" type="number" step="0.000001" required className="text-base sm:text-sm" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <select
                id="currency"
                name="currency"
                defaultValue="SOL"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                {isOwlEnabled() && <option value="OWL">OWL</option>}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max_tickets">Max Tickets (optional)</Label>
            <Input
              id="max_tickets"
              name="max_tickets"
              type="number"
              min="1"
              placeholder="Leave empty for unlimited tickets"
            />
            <p className="text-xs text-muted-foreground">
              Set a limit on the total number of tickets that can be purchased. Leave empty for unlimited.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="min_tickets">Goal: Minimum Tickets Required (optional)</Label>
            <Input
              id="min_tickets"
              name="min_tickets"
              type="number"
              min="1"
              defaultValue="50"
              placeholder="50 (recommended)"
            />
            <p className="text-xs text-muted-foreground">
              Raffle will only be eligible to draw once this minimum is reached. Recommended: 50 tickets.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rank">Rank (optional)</Label>
              <Input
                id="rank"
                name="rank"
                type="text"
                placeholder="e.g., #123 or 123"
              />
              <p className="text-xs text-muted-foreground">
                Optional rank metadata (text or integer)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="floor_price">Floor Price (prize value for NFT)</Label>
              <Input
                id="floor_price"
                name="floor_price"
                type="text"
                placeholder="e.g., 0.25 or 5.5 (in raffle currency)"
              />
              <p className="text-xs text-muted-foreground">
                Prize value for this NFT raffle. Used as the profit threshold: revenue above this amount goes to rev share.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status *</Label>
            <select
              id="status"
              name="status"
              defaultValue="draft"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="draft">Draft</option>
              <option value="live">Live</option>
              <option value="ready_to_draw">Ready to Draw</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="theme_accent">Theme Accent *</Label>
            <select
              id="theme_accent"
              name="theme_accent"
              value={themeAccent}
              onChange={(e) => setThemeAccent(e.target.value as ThemeAccent)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="prime">Prime Time (Electric Green)</option>
              <option value="midnight">Midnight Drop (Cool Teal)</option>
              <option value="dawn">Dawn Run (Soft Lime)</option>
            </select>
          </div>

          <div className="space-y-4">
            <Label>Night Mode Presets (optional)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {NIGHT_MODE_PRESETS.map(preset => (
                <Button
                  key={preset.name}
                  type="button"
                  variant={selectedPreset === preset.name ? 'default' : 'outline'}
                  onClick={() => handlePresetSelect(preset.name)}
                  className="flex flex-col h-auto py-3 min-h-[60px] touch-manipulation"
                >
                  <span className="font-semibold text-sm sm:text-base">{preset.label}</span>
                  <span className="text-xs opacity-80">{preset.description}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start_time">Start Time *</Label>
              <div className="flex gap-2">
                <Input
                  id="start_time"
                  name="start_time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  className="text-base sm:text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const now = new Date()
                    const year = now.getFullYear()
                    const month = String(now.getMonth() + 1).padStart(2, '0')
                    const day = String(now.getDate()).padStart(2, '0')
                    const hours = String(now.getHours()).padStart(2, '0')
                    const minutes = String(now.getMinutes()).padStart(2, '0')
                    setStartTime(`${year}-${month}-${day}T${hours}:${minutes}`)
                  }}
                  title="Set to current time"
                  className="touch-manipulation min-h-[44px] px-3 sm:px-4"
                >
                  Now
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_time">End Time * (Max 7 days from start)</Label>
              <div className="flex gap-2">
                <Input
                  id="end_time"
                  name="end_time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  className="text-base sm:text-sm flex-1"
                  max={startTime ? (() => {
                    const maxDate = new Date(startTime)
                    maxDate.setDate(maxDate.getDate() + 7)
                    return maxDate.toISOString().slice(0, 16)
                  })() : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const base = startTime ? new Date(startTime) : new Date()
                    const maxDate = new Date(base)
                    maxDate.setDate(maxDate.getDate() + 7)
                    const year = maxDate.getFullYear()
                    const month = String(maxDate.getMonth() + 1).padStart(2, '0')
                    const day = String(maxDate.getDate()).padStart(2, '0')
                    const hours = String(maxDate.getHours()).padStart(2, '0')
                    const minutes = String(maxDate.getMinutes()).padStart(2, '0')
                    setEndTime(`${year}-${month}-${day}T${hours}:${minutes}`)
                  }}
                  title="Set to 7 days from start"
                  className="touch-manipulation min-h-[44px] px-3 sm:px-4"
                >
                  Max
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Raffles have a maximum duration of 7 days.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button type="submit" disabled={loading} className="flex-1 touch-manipulation min-h-[44px] text-base sm:text-sm">
              {loading ? 'Creating...' : 'Create Raffle'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              className="touch-manipulation min-h-[44px] text-base sm:text-sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

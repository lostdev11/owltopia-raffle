'use client'

import { useMemo, useState } from 'react'
import { Check, Image as ImageIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl, proxyThumbImageUrl } from '@/lib/raffle-display-image-url'
import {
  filterWalletNfts,
  groupWalletNftsByCollection,
  walletNftCollectionDisplayLabel,
} from '@/lib/raffles/wallet-nft-picker'
import { OWL_TRANSFER_MAX_SELECT } from '@/lib/owl-transfer/constants'
import { cn } from '@/lib/utils'

const THUMB = 160

type Props = {
  nfts: WalletNft[]
  selectedMints: Set<string>
  onToggle: (nft: WalletNft) => void
  /** Select the first N mints from the currently filtered list (capped by maxSelect). */
  onSelectMints: (mints: string[]) => void
  maxSelect?: number
  disabled?: boolean
}

export function OwlTransferMultiNftPicker({
  nfts,
  selectedMints,
  onToggle,
  onSelectMints,
  maxSelect = OWL_TRANSFER_MAX_SELECT,
  disabled,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collectionKey, setCollectionKey] = useState<string | 'all'>('all')

  const collections = useMemo(() => groupWalletNftsByCollection(nfts), [nfts])
  const filtered = useMemo(
    () => filterWalletNfts({ nfts, searchQuery, collectionKey }),
    [nfts, searchQuery, collectionKey]
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="owl-transfer-nft-search">Search</Label>
          <Input
            id="owl-transfer-nft-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Name, collection, or mint"
            disabled={disabled}
            className="bg-black/40"
          />
        </div>
        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="owl-transfer-nft-collection">Collection</Label>
          <select
            id="owl-transfer-nft-collection"
            value={collectionKey}
            onChange={(e) => setCollectionKey(e.target.value)}
            disabled={disabled}
            className="flex h-10 w-full rounded-md border border-input bg-black/40 px-3 text-sm"
          >
            <option value="all">All collections ({nfts.length})</option>
            {collections.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {selectedMints.size} / {maxSelect} selected
          {filtered.length !== nfts.length ? ` · showing ${filtered.length}` : ''}
        </span>
        <button
          type="button"
          className="font-semibold text-theme-prime hover:underline disabled:opacity-40"
          disabled={disabled || filtered.length === 0}
          onClick={() =>
            onSelectMints(filtered.slice(0, maxSelect).map((nft) => nft.mint))
          }
        >
          Select up to {maxSelect}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-6 text-center text-sm text-muted-foreground">
          No NFTs match this filter.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((nft) => {
            const selected = selectedMints.has(nft.mint)
            const atCap = !selected && selectedMints.size >= maxSelect
            return (
              <li key={nft.mint}>
                <button
                  type="button"
                  disabled={disabled || atCap}
                  onClick={() => onToggle(nft)}
                  className={cn(
                    'relative w-full overflow-hidden rounded-xl border text-left transition',
                    selected
                      ? 'border-emerald-400/70 ring-1 ring-emerald-400/40'
                      : 'border-white/10 hover:border-white/25',
                    (disabled || atCap) && !selected && 'opacity-40'
                  )}
                >
                  <div className="aspect-square bg-muted">
                    {nft.image ? (
                      <img
                        src={
                          proxyThumbImageUrl(nft.image, THUMB) ??
                          getRaffleDisplayImageUrl(nft.image) ??
                          nft.image
                        }
                        alt={nft.name ?? nft.mint}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5 p-2">
                    <p className="truncate text-xs font-medium text-white">
                      {nft.name?.trim() || `${nft.mint.slice(0, 4)}…${nft.mint.slice(-4)}`}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {walletNftCollectionDisplayLabel(nft)}
                    </p>
                  </div>
                  {selected ? (
                    <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-black">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

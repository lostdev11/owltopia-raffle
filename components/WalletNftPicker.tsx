'use client'

import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import {
  filterWalletNfts,
  groupWalletNftsByCollection,
  paginateWalletNfts,
  sortWalletNfts,
  walletNftMintMatches,
  type WalletNftSort,
  type WalletNftViewMode,
} from '@/lib/raffles/wallet-nft-picker'

const DEFAULT_PAGE_SIZE = 24

export interface WalletNftPickerProps {
  nfts: WalletNft[]
  selectedMint: string | null
  onSelect: (nft: WalletNft) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  /** Optional mint / asset id field for Core, compressed, or copy-paste from explorer. */
  showMintPaste?: boolean
  mintInput?: string
  onMintInputChange?: (mint: string) => void
  pageSize?: number
  searchInputId?: string
  mintInputId?: string
}

function NftThumb({
  nft,
  className,
}: {
  nft: WalletNft
  className?: string
}) {
  if (nft.image) {
    return (
      <img
        src={getRaffleDisplayImageUrl(nft.image) ?? nft.image}
        alt={nft.name ?? nft.mint}
        className={className}
        onError={(e) => {
          const el = e.currentTarget
          const fallback = nft.image
          if (fallback && el.src !== fallback) {
            el.src = fallback
          }
        }}
      />
    )
  }
  return (
    <div className={`flex items-center justify-center text-xs text-muted-foreground bg-muted ${className ?? ''}`}>
      No image
    </div>
  )
}

export function WalletNftPicker({
  nfts,
  selectedMint,
  onSelect,
  searchQuery,
  onSearchQueryChange,
  showMintPaste = false,
  mintInput = '',
  onMintInputChange,
  pageSize = DEFAULT_PAGE_SIZE,
  searchInputId = 'nft-search',
  mintInputId = 'nft-mint-paste',
}: WalletNftPickerProps) {
  const [collectionKey, setCollectionKey] = useState<string | 'all'>('all')
  const [viewMode, setViewMode] = useState<WalletNftViewMode>('grid')
  const [sort, setSort] = useState<WalletNftSort>('name')
  const [page, setPage] = useState(0)

  const collections = useMemo(() => groupWalletNftsByCollection(nfts), [nfts])

  const filtered = useMemo(
    () => sortWalletNfts(filterWalletNfts({ nfts, searchQuery, collectionKey }), sort),
    [nfts, searchQuery, collectionKey, sort]
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageItems = useMemo(
    () => paginateWalletNfts(filtered, safePage, pageSize),
    [filtered, safePage, pageSize]
  )

  useEffect(() => {
    setPage(0)
  }, [searchQuery, collectionKey, sort, nfts.length])

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1))
    }
  }, [page, totalPages])

  const handleSelect = (nft: WalletNft) => {
    onSelect(nft)
    onMintInputChange?.(nft.mint)
  }

  return (
    <div className="space-y-3">
      {showMintPaste && onMintInputChange && (
        <div className="space-y-1">
          <Label htmlFor={mintInputId} className="text-xs">
            Or paste mint / asset id
          </Label>
          <Input
            id={mintInputId}
            type="text"
            placeholder="Paste from wallet or explorer if you can't find it below"
            value={mintInput}
            onChange={(e) => {
              const v = e.target.value
              onMintInputChange(v)
              const match = nfts.find((nft) => walletNftMintMatches(nft.mint, v.trim()))
              if (match) onSelect(match)
            }}
            className="text-sm min-h-[40px] font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Useful for Metaplex Core or compressed NFTs, or when you have the address from your wallet app.
          </p>
        </div>
      )}

      {nfts.length > 0 && (
        <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor={searchInputId} className="text-xs">
            Search
          </Label>
          <Input
            id={searchInputId}
            type="text"
            placeholder="Name, collection, symbol, or mint…"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="text-sm min-h-[40px]"
          />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1 min-w-[8.5rem]">
            <Label htmlFor="nft-sort" className="text-xs">
              Sort
            </Label>
            <select
              id="nft-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as WalletNftSort)}
              className="flex h-10 w-full min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="name">Name</option>
              <option value="collection">Collection</option>
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground block">View</span>
            <div className="flex rounded-md border border-input overflow-hidden h-10">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
                className={`px-3 flex items-center justify-center ${
                  viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
                className={`px-3 flex items-center justify-center border-l border-input ${
                  viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {collections.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="nft-collection-filter" className="text-xs">
            Collection
          </Label>
          <select
            id="nft-collection-filter"
            value={collectionKey}
            onChange={(e) => setCollectionKey(e.target.value)}
            className="flex h-10 w-full min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">All collections ({nfts.length})</option>
            {collections.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filtered.length === 0
            ? 'No NFTs match your filters.'
            : `Showing ${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, filtered.length)} of ${filtered.length}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Try a different collection, clear the search, or paste the mint address below.
        </p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {pageItems.map((nft) => (
            <button
              key={`${nft.tokenAccount}-${nft.mint}`}
              type="button"
              onClick={() => handleSelect(nft)}
              className={`rounded-lg border-2 p-2 text-left transition-colors ${
                selectedMint && walletNftMintMatches(selectedMint, nft.mint)
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-muted-foreground/50'
              }`}
            >
              <div className="aspect-square rounded overflow-hidden bg-muted mb-2">
                <NftThumb nft={nft} className="w-full h-full object-cover" />
              </div>
              <p className="text-xs font-medium truncate" title={nft.name ?? nft.mint}>
                {nft.name ?? `${nft.mint.slice(0, 4)}…`}
              </p>
              {nft.collectionName ? (
                <p className="text-[10px] text-muted-foreground truncate" title={nft.collectionName}>
                  {nft.collectionName}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {pageItems.map((nft) => {
            const selected = selectedMint && walletNftMintMatches(selectedMint, nft.mint)
            return (
              <li key={`${nft.tokenAccount}-${nft.mint}`}>
                <button
                  type="button"
                  onClick={() => handleSelect(nft)}
                  className={`flex w-full items-center gap-3 p-2.5 text-left transition-colors ${
                    selected ? 'bg-primary/10' : 'hover:bg-muted/60'
                  }`}
                >
                  <div className="h-12 w-12 shrink-0 rounded overflow-hidden">
                    <NftThumb nft={nft} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{nft.name ?? 'Unnamed NFT'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {nft.collectionName ?? 'No collection'}
                      {nft.symbol ? ` · ${nft.symbol}` : ''}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{nft.mint}</p>
                  </div>
                  {selected ? (
                    <Badge variant="secondary" className="shrink-0">
                      Selected
                    </Badge>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
        </>
      )}
    </div>
  )
}

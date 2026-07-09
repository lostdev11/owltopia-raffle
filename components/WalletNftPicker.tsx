'use client'

import { useEffect, useMemo, useState } from 'react'
import { LayoutGrid, List, ChevronLeft, ChevronRight, Image } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import { useCoarsePointer } from '@/lib/hooks/use-coarse-pointer'
import {
  filterWalletNfts,
  groupWalletNftsByCollection,
  paginateWalletNfts,
  sortWalletNfts,
  walletNftCollectionDisplayLabel,
  walletNftMintMatches,
  type WalletNftSort,
  type WalletNftViewMode,
} from '@/lib/raffles/wallet-nft-picker'

const DEFAULT_PAGE_SIZE = 24
const MOBILE_PAGE_SIZE = 16

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

function MintPasteField({
  mintInputId,
  mintInput,
  onMintInputChange,
  nfts,
  onSelect,
}: {
  mintInputId: string
  mintInput: string
  onMintInputChange: (mint: string) => void
  nfts: WalletNft[]
  onSelect: (nft: WalletNft) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={mintInputId} className="text-xs">
        Or paste mint / asset id
      </Label>
      <Input
        id={mintInputId}
        type="text"
        placeholder="Paste from wallet or explorer"
        value={mintInput}
        onChange={(e) => {
          const v = e.target.value
          onMintInputChange(v)
          const match = nfts.find((nft) => walletNftMintMatches(nft.mint, v.trim()))
          if (match) onSelect(match)
        }}
        className="text-sm min-h-[44px] font-mono touch-manipulation"
      />
      <p className="text-xs text-muted-foreground">
        Copy the NFT address from Phantom, Solflare, or an explorer if browsing is easier.
      </p>
    </div>
  )
}

function WalletNftPickerBody({
  nfts,
  selectedMint,
  onSelect,
  searchQuery,
  onSearchQueryChange,
  pageSize,
  searchInputId,
  defaultViewMode,
}: {
  nfts: WalletNft[]
  selectedMint: string | null
  onSelect: (nft: WalletNft) => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  pageSize: number
  searchInputId: string
  defaultViewMode: WalletNftViewMode
}) {
  const [collectionKey, setCollectionKey] = useState<string | 'all'>('all')
  const [viewMode, setViewMode] = useState<WalletNftViewMode>(defaultViewMode)
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
  }

  if (nfts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No NFTs loaded. Paste a mint address above, or load your wallet inventory first.
      </p>
    )
  }

  return (
    <div className="space-y-3">
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
            className="text-sm min-h-[44px] touch-manipulation"
          />
        </div>
        <div className="flex gap-2">
          <div className="space-y-1 min-w-[8.5rem] flex-1 sm:flex-none">
            <Label htmlFor="nft-sort" className="text-xs">
              Sort
            </Label>
            <select
              id="nft-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as WalletNftSort)}
              className="flex h-11 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
            >
              <option value="name">Name</option>
              <option value="collection">Collection</option>
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground block">View</span>
            <div className="flex rounded-md border border-input overflow-hidden h-11">
              <button
                type="button"
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
                className={`px-3 flex items-center justify-center min-w-[44px] touch-manipulation ${
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
                className={`px-3 flex items-center justify-center min-w-[44px] border-l border-input touch-manipulation ${
                  viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {collections.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="nft-collection-filter" className="text-xs">
            Collection
          </Label>
          <select
            id="nft-collection-filter"
            value={collectionKey}
            onChange={(e) => setCollectionKey(e.target.value)}
            className="flex h-11 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm touch-manipulation"
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
              className="h-10 px-3 touch-manipulation"
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
              className="h-10 px-3 touch-manipulation"
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
          Try a different collection, clear the search, or paste the mint address above.
        </p>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {pageItems.map((nft) => (
            <button
              key={`${nft.tokenAccount}-${nft.mint}`}
              type="button"
              onClick={() => handleSelect(nft)}
              className={`rounded-lg border-2 p-2 text-left transition-colors touch-manipulation ${
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
              <p
                className="text-[10px] text-muted-foreground truncate"
                title={walletNftCollectionDisplayLabel(nft)}
              >
                {walletNftCollectionDisplayLabel(nft)}
              </p>
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
                  className={`flex w-full items-center gap-3 p-3 text-left transition-colors touch-manipulation min-h-[64px] ${
                    selected ? 'bg-primary/10' : 'hover:bg-muted/60 active:bg-muted'
                  }`}
                >
                  <div className="h-12 w-12 shrink-0 rounded overflow-hidden">
                    <NftThumb nft={nft} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{nft.name ?? 'Unnamed NFT'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {walletNftCollectionDisplayLabel(nft)}
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
  const coarsePointer = useCoarsePointer()
  const [browseOpen, setBrowseOpen] = useState(false)
  const mobilePageSize = Math.min(pageSize, MOBILE_PAGE_SIZE)
  const defaultViewMode: WalletNftViewMode = coarsePointer ? 'list' : 'grid'

  const collections = useMemo(() => groupWalletNftsByCollection(nfts), [nfts])
  const collectionSummary = useMemo(() => {
    if (collections.length === 0) return null
    const named = collections
      .filter((c) => c.key !== '__uncategorized__')
      .map((c) => c.label)
    if (named.length === 0) return null
    if (named.length <= 2) return named.join(', ')
    return `${named.slice(0, 2).join(', ')} +${named.length - 2} more`
  }, [collections])

  const selectedNft = useMemo(
    () => (selectedMint ? nfts.find((nft) => walletNftMintMatches(nft.mint, selectedMint)) ?? null : null),
    [nfts, selectedMint]
  )

  const handleSelect = (nft: WalletNft) => {
    onSelect(nft)
    onMintInputChange?.(nft.mint)
  }

  const mintPaste =
    showMintPaste && onMintInputChange ? (
      <MintPasteField
        mintInputId={mintInputId}
        mintInput={mintInput}
        onMintInputChange={onMintInputChange}
        nfts={nfts}
        onSelect={handleSelect}
      />
    ) : null

  if (coarsePointer && nfts.length > 0) {
    return (
      <div className="space-y-3">
        {mintPaste}
        {selectedNft ? (
          <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="h-14 w-14 shrink-0 rounded overflow-hidden">
              <NftThumb nft={selectedNft} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{selectedNft.name ?? 'Selected NFT'}</p>
              <p className="text-xs text-muted-foreground truncate">
                {walletNftCollectionDisplayLabel(selectedNft)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Browse your wallet NFTs or paste a mint address to select a prize.
          </p>
        )}
        <Button
          type="button"
          variant="default"
          className="w-full min-h-[48px] touch-manipulation text-base"
          onClick={() => setBrowseOpen(true)}
        >
          <Image className="h-5 w-5 mr-2 shrink-0" aria-hidden />
          Browse {nfts.length} NFT{nfts.length === 1 ? '' : 's'}
          {collectionSummary ? (
            <span className="ml-1 font-normal text-primary-foreground/85">· {collectionSummary}</span>
          ) : null}
        </Button>
        <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
          <DialogContent className="left-0 top-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-4">
            <DialogHeader className="shrink-0 border-b px-4 py-3 text-left sm:border-0 sm:px-0 sm:pt-0">
              <DialogTitle>Choose prize NFT</DialogTitle>
              <DialogDescription>
                Filter by collection, switch to list view, or search by name or mint.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-0">
              <WalletNftPickerBody
                nfts={nfts}
                selectedMint={selectedMint}
                onSelect={handleSelect}
                searchQuery={searchQuery}
                onSearchQueryChange={onSearchQueryChange}
                pageSize={mobilePageSize}
                searchInputId={`${searchInputId}-dialog`}
                defaultViewMode={defaultViewMode}
              />
            </div>
            <div className="shrink-0 border-t p-4 sm:border-0 sm:px-0 sm:pb-0">
              <Button
                type="button"
                className="w-full min-h-[48px] touch-manipulation text-base"
                onClick={() => setBrowseOpen(false)}
              >
                {selectedMint ? 'Done' : 'Close'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {mintPaste}
      <WalletNftPickerBody
        nfts={nfts}
        selectedMint={selectedMint}
        onSelect={handleSelect}
        searchQuery={searchQuery}
        onSearchQueryChange={onSearchQueryChange}
        pageSize={pageSize}
        searchInputId={searchInputId}
        defaultViewMode={defaultViewMode}
      />
    </div>
  )
}

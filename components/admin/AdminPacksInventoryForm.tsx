'use client'

import { useCallback, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { Loader2 } from 'lucide-react'
import { PacksAdminExtraDetails } from '@/components/admin/PacksAdminExtraDetails'
import { WalletNftPicker } from '@/components/WalletNftPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { packRtpPercentLabel } from '@/lib/packs/admin-copy'
import {
  PACK_NFT_MAX_FAIR_SOL,
  PACK_NFT_MIN_FAIR_SOL,
} from '@/lib/packs/config'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import {
  packNftBandLabel,
  packNftFairValueInRange,
  simulatePackEvFromInventory,
} from '@/lib/packs/ev-simulator'
import {
  packInventoryPrizeStandardLabel,
  type PackInventoryPrizeStandard,
} from '@/lib/packs/types'
import {
  formatPackDepositError,
  packDepositDisabledReason,
  packDepositRequirements,
} from '@/lib/packs/deposit-requirements'
import { packsNftBlockReason } from '@/lib/packs/inventory-eligibility'
import { walletNftMintMatches } from '@/lib/raffles/wallet-nft-picker'
import { depositPrizeNftToEscrowFromWallet } from '@/lib/solana/deposit-prize-nft-to-escrow-wallet'
import { fetchWalletNftsWithRetry } from '@/lib/solana/fetch-wallet-nfts-api'
import { prizeStandardFromWalletNft } from '@/lib/solana/prize-nft-standard'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import { minimalWalletNftForEscrowTransfer } from '@/lib/solana/wallet-tokens'

export type AdminPacksInventoryItem = {
  id: string
  mint_address: string
  name: string | null
  image_url?: string | null
  fair_value_sol: number
  prize_standard?: PackInventoryPrizeStandard | string | null
  status: string
}

type DraftRow = {
  nft: WalletNft
  floor: string
  customFloor: boolean
  depositSig?: string
  registerError?: string
  status: 'pending' | 'deposited' | 'registered' | 'failed'
}

function parseFloor(raw: string): number | null {
  const n = Number(raw)
  return packNftFairValueInRange(n) ? n : null
}

function shortenMint(mint: string): string {
  if (mint.length <= 10) return mint
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

function packsPrizeStandardForNft(nft: WalletNft): PackInventoryPrizeStandard {
  const detected = prizeStandardFromWalletNft(nft)
  if (detected === 'mpl_core' || detected === 'compressed') return detected
  return 'spl'
}

async function registerInventoryNft(input: {
  mint_address: string
  fair_value_sol: number
  name: string | null
  image_url: string | null
  prize_standard: PackInventoryPrizeStandard
}): Promise<void> {
  const res = await fetch('/api/admin/packs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : 'Failed to register NFT')
  }
}

export function AdminPacksInventoryForm({
  vaultAddress,
  inventory,
  owlSolPrice,
  onRegistered,
}: {
  vaultAddress: string | null
  inventory: AdminPacksInventoryItem[]
  owlSolPrice: number | null
  onRegistered: () => Promise<void>
}) {
  const { connection } = useConnection()
  const { publicKey, wallet } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [loadingNfts, setLoadingNfts] = useState(false)
  const [nftError, setNftError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [mintInput, setMintInput] = useState('')
  const [defaultFloor, setDefaultFloor] = useState('0.1')
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const selectedMints = useMemo(() => new Set(drafts.map((d) => d.nft.mint)), [drafts])
  const problemMints = useMemo(
    () => new Set(drafts.filter((d) => d.status === 'failed' || d.registerError).map((d) => d.nft.mint)),
    [drafts]
  )

  const draftFloors = useMemo(
    () =>
      drafts
        .filter((d) => d.status !== 'registered')
        .map((d) => parseFloor(d.floor))
        .filter((n): n is number => n != null),
    [drafts]
  )

  const liveEv = useMemo(
    () =>
      simulatePackEvFromInventory({
        owlSolPrice,
        inventory,
        draftFloors,
      }),
    [draftFloors, inventory, owlSolPrice]
  )

  const allFloorsValid =
    drafts.length > 0 && drafts.every((d) => d.status === 'registered' || parseFloor(d.floor) != null)
  const pendingDrafts = drafts.filter((d) => d.status !== 'registered')
  const depositRequirements = useMemo(
    () =>
      packDepositRequirements({
        vaultAddress,
        walletConnected: Boolean(publicKey),
        pendingCount: pendingDrafts.length,
        allFloorsValid,
        busy,
      }),
    [allFloorsValid, busy, pendingDrafts.length, publicKey, vaultAddress]
  )
  const depositDisabledReason = useMemo(
    () =>
      packDepositDisabledReason({
        vaultAddress,
        walletConnected: Boolean(publicKey),
        pendingCount: pendingDrafts.length,
        allFloorsValid,
        busy,
      }),
    [allFloorsValid, busy, pendingDrafts.length, publicKey, vaultAddress]
  )
  const canDeposit = depositDisabledReason == null

  const loadWalletNfts = useCallback(async () => {
    if (!publicKey) return
    setLoadingNfts(true)
    setNftError(null)
    const walletAddr = publicKey.toBase58()
    try {
      const apiResult = await fetchWalletNftsWithRetry(walletAddr)
      let nfts: WalletNft[] = apiResult.nfts
      if (nfts.length === 0 || apiResult.res?.status === 503) {
        const { getWalletNfts } = await import('@/lib/solana/wallet-tokens')
        try {
          nfts = await getWalletNfts(connection, publicKey)
        } catch (rpcErr) {
          if (nfts.length === 0) throw rpcErr
        }
      }
      setWalletNfts(nfts)
      setSearchQuery('')
    } catch (e) {
      setNftError(e instanceof Error ? e.message : 'Failed to load wallet NFTs')
      setWalletNfts(null)
    } finally {
      setLoadingNfts(false)
    }
  }, [connection, publicKey])

  const addDraft = useCallback(
    (nft: WalletNft) => {
      const blocked = packsNftBlockReason(nft)
      if (blocked) {
        setFormError(blocked)
        return
      }
      setFormError(null)
      setDrafts((prev) => {
        if (prev.some((d) => walletNftMintMatches(d.nft.mint, nft.mint))) return prev
        return [
          ...prev,
          { nft, floor: defaultFloor, customFloor: false, status: 'pending' },
        ]
      })
    },
    [defaultFloor]
  )

  const toggleNft = useCallback(
    (nft: WalletNft) => {
      setDrafts((prev) => {
        const exists = prev.some((d) => walletNftMintMatches(d.nft.mint, nft.mint))
        if (exists) return prev.filter((d) => !walletNftMintMatches(d.nft.mint, nft.mint))
        const blocked = packsNftBlockReason(nft)
        if (blocked) {
          setFormError(blocked)
          return prev
        }
        setFormError(null)
        return [
          ...prev,
          { nft, floor: defaultFloor, customFloor: false, status: 'pending' },
        ]
      })
    },
    [defaultFloor]
  )

  function handleDefaultFloorChange(next: string) {
    setDefaultFloor(next)
    setDrafts((prev) => prev.map((d) => (d.customFloor ? d : { ...d, floor: next })))
  }

  function handleMintInputChange(value: string) {
    setMintInput(value)
    const trimmed = value.trim()
    if (!trimmed) return
    const match = walletNfts?.find((nft) => walletNftMintMatches(nft.mint, trimmed))
    if (match) {
      addDraft(match)
      return
    }
    try {
      new PublicKey(trimmed)
    } catch {
      return
    }
    addDraft(minimalWalletNftForEscrowTransfer(trimmed))
  }

  async function depositAndAdd() {
    if (!publicKey || !vaultAddress) {
      setFormError('Connect a wallet and configure the packs vault first.')
      return
    }
    setBusy(true)
    setFormError(null)
    setProgress(null)
    const queue = drafts.filter((d) => d.status !== 'registered')
    let registered = 0
    const nextDrafts = [...drafts]

    const patch = (mint: string, update: Partial<DraftRow>) => {
      const i = nextDrafts.findIndex((d) => walletNftMintMatches(d.nft.mint, mint))
      if (i >= 0) nextDrafts[i] = { ...nextDrafts[i]!, ...update }
      setDrafts([...nextDrafts])
    }

    try {
      for (let i = 0; i < queue.length; i++) {
        const row = queue[i]!
        const floor = parseFloor(row.floor)
        if (floor == null) {
          patch(row.nft.mint, {
            status: 'failed',
            registerError: `Floor must be ${PACK_NFT_MIN_FAIR_SOL}–${PACK_NFT_MAX_FAIR_SOL} SOL`,
          })
          continue
        }

        let depositSig = row.depositSig
        if (row.status !== 'deposited' || !depositSig) {
          setProgress(`Depositing ${i + 1}/${queue.length}: ${row.nft.name || shortenMint(row.nft.mint)}`)
          const dep = await depositPrizeNftToEscrowFromWallet({
            connection,
            publicKey,
            sendTransaction,
            walletAdapter: wallet?.adapter ?? null,
            selectedNft: row.nft,
            prizeMintAddress: row.nft.mint,
            escrowAddress: vaultAddress,
            logCtx: {
              raffleId: 'packs-inventory',
              nftMint: row.nft.mint,
              transferAssetId: row.nft.mint,
              escrowAddress: vaultAddress,
              fromWallet: publicKey.toBase58(),
            },
          })
          if (!dep.ok) {
            patch(row.nft.mint, {
              status: 'failed',
              registerError: formatPackDepositError(dep.error),
            })
            continue
          }
          depositSig = dep.signature
          patch(row.nft.mint, { status: 'deposited', depositSig, registerError: undefined })
        }

        setProgress(`Registering ${i + 1}/${queue.length}: ${row.nft.name || shortenMint(row.nft.mint)}`)
        try {
          await registerInventoryNft({
            mint_address: row.nft.mint,
            fair_value_sol: floor,
            name: row.nft.name,
            image_url: row.nft.image,
            prize_standard: packsPrizeStandardForNft(row.nft),
          })
          patch(row.nft.mint, { status: 'registered', depositSig, registerError: undefined })
          registered += 1
        } catch (e) {
          patch(row.nft.mint, {
            status: 'deposited',
            depositSig,
            registerError: e instanceof Error ? e.message : 'Register failed — retry without sending again',
          })
        }
      }

      if (registered > 0) await onRegistered()
      setDrafts((prev) => prev.filter((d) => d.status !== 'registered'))
      if (walletNfts) await loadWalletNfts()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Add NFTs to inventory</h2>
        <p className="text-xs text-muted-foreground">
          Load this wallet, pick NFTs, set a floor price ({PACK_NFT_MIN_FAIR_SOL}–{PACK_NFT_MAX_FAIR_SOL}{' '}
          SOL; higher floors = rarer odds), then send them to the packs vault. Floor is how we value
          the NFT for prize odds. Some NFT types (pNFT, frozen, nested) can’t be paid out yet.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p>
          Typical prize: about {liveEv.estimatedEvSol.toFixed(4)} SOL (aiming for{' '}
          {liveEv.targetEvSol} SOL). Players get back about{' '}
          {packRtpPercentLabel(liveEv.estimatedRtpBps)} of the pack price.
        </p>
        <PacksAdminExtraDetails notes={liveEv.notes} />
      </div>

      <div>
        <Label htmlFor="packs-default-floor">Default floor price (SOL)</Label>
        <Input
          id="packs-default-floor"
          inputMode="decimal"
          value={defaultFloor}
          onChange={(e) => handleDefaultFloorChange(e.target.value)}
          placeholder="0.1"
          className="mt-1 min-h-[44px] touch-manipulation"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to newly selected NFTs. Override any row if floors differ. Changing this updates
          rows you have not customized.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] touch-manipulation"
        disabled={loadingNfts || !publicKey}
        onClick={() => void loadWalletNfts()}
      >
        {loadingNfts ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </>
        ) : (
          'Load NFTs from wallet'
        )}
      </Button>
      {nftError && <p className="text-sm text-destructive">{nftError}</p>}

      {walletNfts && (
        <WalletNftPicker
          nfts={walletNfts}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          selectionMode="multi"
          selectedMints={selectedMints}
          onToggle={toggleNft}
          onSelect={addDraft}
          showMintPaste
          mintInput={mintInput}
          onMintInputChange={handleMintInputChange}
          searchInputId="packs-inventory-nft-search"
          mintInputId="packs-inventory-mint-paste"
          dialogTitle="Select NFTs to deposit"
          dialogDescription="SPL, Metaplex Core, and compressed NFTs. pNFT and frozen/nested assets cannot be paid out of the packs vault."
          problemMints={problemMints}
          statusLabel={(nft) => packsNftBlockReason(nft)}
        />
      )}

      {drafts.length > 0 && (
        <ul className="divide-y rounded-md border">
          {drafts.map((row) => {
            const floorNum = parseFloor(row.floor)
            const band = floorNum != null ? packNftBandLabel(floorNum) : null
            return (
              <li key={row.nft.mint} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {row.nft.image ? (
                    <img
                      src={row.nft.image}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                      NFT
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.nft.name || 'NFT'}</p>
                    <p className="font-mono text-xs text-muted-foreground">{shortenMint(row.nft.mint)}</p>
                    <p className="text-xs text-muted-foreground">
                      {packInventoryPrizeStandardLabel(packsPrizeStandardForNft(row.nft))}
                      {band ? ` · ${band} band` : ''}
                      {row.status !== 'pending' ? ` · ${row.status}` : ''}
                    </p>
                    {row.registerError && (
                      <p className="text-xs text-destructive">
                        {formatPackDepositError(row.registerError)}
                      </p>
                    )}
                    {row.status === 'deposited' && row.depositSig && (
                      <p className="text-xs text-muted-foreground">
                        On-chain yes — retry register without sending again
                      </p>
                    )}
                    {!row.nft.tokenAccount && (
                      <p className="text-xs text-muted-foreground">
                        Pasted mint — must be SPL, Core, or cNFT in this wallet
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="min-w-[7rem] flex-1 sm:flex-none">
                    <Label htmlFor={`floor-${row.nft.mint}`} className="text-xs">
                      Floor (SOL)
                    </Label>
                    <Input
                      id={`floor-${row.nft.mint}`}
                      inputMode="decimal"
                      value={row.floor}
                      onChange={(e) => {
                        const floor = e.target.value
                        setDrafts((prev) =>
                          prev.map((d) =>
                            walletNftMintMatches(d.nft.mint, row.nft.mint)
                              ? { ...d, floor, customFloor: true }
                              : d
                          )
                        )
                      }}
                      className="min-h-[44px] touch-manipulation"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-[44px] touch-manipulation"
                    disabled={busy}
                    onClick={() =>
                      setDrafts((prev) =>
                        prev.filter((d) => !walletNftMintMatches(d.nft.mint, row.nft.mint))
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {formError && <p className="text-sm text-destructive">{formError}</p>}
      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}

      <div className="rounded-md border bg-muted/20 p-3 text-sm">
        <p className="font-medium">Before you can deposit</p>
        <ul className="mt-2 space-y-1.5">
          {depositRequirements.map((req) => (
            <li
              key={req.id}
              className={req.met ? 'text-muted-foreground' : 'text-foreground'}
            >
              <span aria-hidden>{req.met ? '✓' : '○'}</span> {req.label}
            </li>
          ))}
        </ul>
        {pendingDrafts.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ready to deposit: {pendingDrafts.length} NFT
            {pendingDrafts.length === 1 ? '' : 's'}
          </p>
        )}
        {depositDisabledReason && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">{depositDisabledReason}</p>
        )}
      </div>

      <Button
        type="button"
        className="min-h-[44px] w-full touch-manipulation sm:w-auto"
        disabled={!canDeposit}
        onClick={() => void depositAndAdd()}
      >
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Working…
          </>
        ) : pendingDrafts.some((d) => d.status === 'deposited') ? (
          'Retry register / deposit remaining'
        ) : (
          `Deposit & add${pendingDrafts.length ? ` (${pendingDrafts.length})` : ''}`
        )}
      </Button>
    </div>
  )
}

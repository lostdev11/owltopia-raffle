'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import {
  isMplCoreNoApprovalsError,
  mplCoreNoApprovalsEscrowMessage,
} from '@/lib/solana/mpl-core-transfer-errors'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  logEscrowDepositAbort,
  logEscrowDepositError,
  logEscrowDepositPath,
  logEscrowDepositSigned,
  logEscrowDepositStart,
  logEscrowDepositVerify,
} from '@/lib/solana/escrow-deposit-log'
import {
  verifyPrizeDepositWithRetries,
  isEscrowSplPrizeFrozenVerifyError,
} from '@/lib/raffles/verify-prize-deposit-client'
import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NIGHT_MODE_PRESETS } from '@/lib/night-mode-presets'
import type { ThemeAccent } from '@/lib/types'
import { getThemeAccentBorderStyle, getThemeAccentClasses } from '@/lib/theme-accent'
import { localDateTimeToUtc, utcToLocalDateTime } from '@/lib/utils'
import { isOwlEnabled } from '@/lib/tokens'
import type { NftHolderInWallet, WalletNft, WalletToken } from '@/lib/solana/wallet-tokens'
import { getRaffleDisplayImageUrl } from '@/lib/raffle-display-image-url'
import {
  NFT_RAFFLE_MIN_TICKETS,
  computeNftTicketPriceFromFloor,
} from '@/lib/raffles/nft-raffle-economics'

export function CreateRaffleForm() {
  const router = useRouter()
  const { publicKey, connected, sendTransaction, wallet } = useWallet()
  const { connection } = useConnection()
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>('prime')
  // datetime-local expects a *local* time string. Using toISOString() here would be UTC and can shift by timezone,
  // causing raffles to start/end earlier or later than intended.
  const [startTime, setStartTime] = useState(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
  })
  const [endTime, setEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  /** saving = POST raffle; signing = resolve NFT on RPC + wallet sends prize to escrow */
  const [createStep, setCreateStep] = useState<'idle' | 'saving' | 'signing'>('idle')
  /** Listing image comes from the selected prize NFT metadata. */
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const prizeType = 'nft' as const
  const [selectedNft, setSelectedNft] = useState<WalletNft | null>(null)
  const [walletNfts, setWalletNfts] = useState<WalletNft[] | null>(null)
  const [walletTokens, setWalletTokens] = useState<WalletToken[] | null>(null)
  const [nftSearchQuery, setNftSearchQuery] = useState('')
  const [loadingWalletAssets, setLoadingWalletAssets] = useState(false)
  const [walletAssetsError, setWalletAssetsError] = useState<string | null>(null)
  const [floorPrice, setFloorPrice] = useState('')
  const [floorPriceLoading, setFloorPriceLoading] = useState(false)
  const [floorPriceCurrency, setFloorPriceCurrency] = useState<string | null>(null)
  const [floorPriceAutoNote, setFloorPriceAutoNote] = useState<string | null>(null)
  const [raffleCurrency, setRaffleCurrency] = useState('SOL')
  const [ticketPrice, setTicketPrice] = useState('')

  useEffect(() => {
    if (!selectedNft) {
      setFloorPrice('')
      setFloorPriceLoading(false)
      setFloorPriceCurrency(null)
      setFloorPriceAutoNote(null)
      setTicketPrice('')
      return
    }
    let cancelled = false
    setFloorPriceLoading(true)
    setFloorPriceCurrency(null)
    setFloorPriceAutoNote(null)
    fetch(`/api/nft/floor-price?mint=${encodeURIComponent(selectedNft.mint)}`, { credentials: 'include' })
      .then((r) => {
        if (cancelled) return undefined
        return r.json().then((data) => ({ ok: r.ok, data }))
      })
      .then(
        (
          wrapped:
            | { ok: boolean; data: { floorPrice?: string | null; currency?: string | null; message?: string | null } }
            | undefined
        ) => {
          if (cancelled) return
          if (!wrapped) {
            setFloorPriceAutoNote('Could not check floor price. Enter the prize value manually in your raffle currency.')
            return
          }
          const { ok, data } = wrapped
          if (!ok) {
            setFloorPriceAutoNote(
              typeof data?.message === 'string' && data.message
                ? data.message
                : 'Could not check floor price. Enter the prize value manually in your raffle currency.'
            )
            return
          }
          if (data?.floorPrice != null && data.floorPrice !== '') {
            const fp = String(data.floorPrice)
            setFloorPrice(fp)
            setFloorPriceCurrency(data.currency ?? null)
            updateTicketPriceFromFloor(fp)
            setFloorPriceAutoNote(typeof data.message === 'string' && data.message ? data.message : null)
          } else if (typeof data?.message === 'string' && data.message) {
            setFloorPriceAutoNote(data.message)
          } else {
            setFloorPriceAutoNote('No automatic price for this NFT. Enter a fair floor price in your raffle currency.')
          }
        }
      )
      .catch(() => {
        if (!cancelled) {
          setFloorPriceAutoNote('Could not check floor price. Enter the prize value manually in your raffle currency.')
        }
      })
      .finally(() => {
        if (!cancelled) setFloorPriceLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedNft?.mint])

  const updateTicketPriceFromFloor = (floorValue: string) => {
    const trimmed = floorValue.trim()
    if (!trimmed) {
      setTicketPrice('')
      return
    }
    const floor = parseFloat(trimmed)
    if (Number.isFinite(floor) && floor > 0) {
      const calculated = computeNftTicketPriceFromFloor(floor)
      const formatted =
        calculated >= 1
          ? calculated.toFixed(2)
          : calculated >= 0.01
            ? calculated.toFixed(4)
            : calculated.toFixed(6)
      setTicketPrice(formatted)
    }
  }

  const loadWalletAssets = async () => {
    if (!publicKey) return
    setLoadingWalletAssets(true)
    setWalletAssetsError(null)
    const walletAddr = publicKey.toBase58()
    try {
      // Prefer API first: faster (batch from Helius) and returns more NFTs (paginated).
      const [apiRes, escrowRes] = await Promise.all([
        fetch(`/api/wallet/nfts?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
        fetch(`/api/wallet/escrowed-nft-mints?wallet=${encodeURIComponent(walletAddr)}`, { credentials: 'include' }),
      ])
      let nfts: WalletNft[] = []
      if (apiRes.ok) {
        const data = await apiRes.json()
        nfts = Array.isArray(data) ? data : []
      }
      // Fallback to client RPC when API is unavailable (e.g. no HELIUS_API_KEY) or fails
      if (nfts.length === 0 || apiRes.status === 503) {
        const { getWalletNfts, getWalletTokens } = await import('@/lib/solana/wallet-tokens')
        try {
          nfts = await getWalletNfts(connection, publicKey)
        } catch (rpcErr) {
          if (nfts.length === 0) throw rpcErr
        }
      }
      // Exclude NFTs already in escrow (from parallel fetch)
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
      let tokens: WalletToken[] = []
      try {
        const { getWalletTokens } = await import('@/lib/solana/wallet-tokens')
        tokens = await getWalletTokens(connection, publicKey)
      } catch {
        // tokens are optional for raffle creation
      }
      setWalletNfts(nfts)
      setWalletTokens(tokens)
      setNftSearchQuery('')
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

    if (!selectedNft) {
      alert('Please select an NFT from your wallet for an NFT raffle.')
      return
    }

    try {
      const mintPk = new PublicKey(selectedNft.mint)
      const stakedCheck = await getNftHolderInWallet(connection, mintPk, publicKey, 'confirmed')
      if (stakedCheck && 'delegated' in stakedCheck && stakedCheck.delegated) {
        alert(
          'This NFT is staked or delegated. Unstake it before creating a raffle—it cannot be sent to escrow while staked.'
        )
        return
      }
    } catch {
      // Mint parse or RPC: server will re-check on create
    }

    // Validate 7-day maximum duration
    if (startTime && endTime) {
      const startDate = new Date(localDateTimeToUtc(startTime))
      const endDate = new Date(localDateTimeToUtc(endTime))
      const durationMs = endDate.getTime() - startDate.getTime()
      const durationDays = durationMs / (1000 * 60 * 60 * 24)
      
      if (durationDays > 7) {
        alert('Raffle duration cannot exceed 7 days')
        return
      }
    }

    const formData = new FormData(e.currentTarget)
    const floorPriceValue = (formData.get('floor_price') as string)?.trim() ?? ''
    const fpNum = parseFloat(floorPriceValue)
    if (!floorPriceValue || !Number.isFinite(fpNum) || fpNum <= 0) {
      alert('Enter a valid floor price (prize value) in your raffle currency.')
      return
    }

    setCreateStep('saving')
    setLoading(true)
    const maxTicketsValue = formData.get('max_tickets') as string
    const rankValue = formData.get('rank') as string
    const currency = (formData.get('currency') as string) || 'SOL'
    const data: Record<string, unknown> = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      image_url: imageUrl || null,
      ticket_price: parseFloat(formData.get('ticket_price') as string),
      currency,
      max_tickets: maxTicketsValue ? parseInt(maxTicketsValue) : null,
      min_tickets: NFT_RAFFLE_MIN_TICKETS,
      rank: rankValue && rankValue.trim() ? rankValue.trim() : null,
      floor_price: floorPriceValue,
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
    data.nft_mint_address = selectedNft.mint
    data.nft_token_id = selectedNft.mint
    data.nft_metadata_uri = selectedNft.metadataUri ?? undefined
    data.nft_collection_name = selectedNft.collectionName ?? undefined
    try {
      const response = await fetch('/api/raffles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      })

      if (response.ok) {
        const raffle = await response.json()
        // NFT raffles: one flow — sign transfer to escrow, retry verify until RPC catches up, then redirect
        if (raffle.prize_type === 'nft' && raffle.nft_mint_address && publicKey && (sendTransaction || wallet?.adapter)) {
          try {
            setCreateStep('signing')
            const mintPk = new PublicKey(raffle.nft_mint_address)
            const walletAdapter = wallet?.adapter ?? null

            const escrowRes = await fetch('/api/config/prize-escrow', { credentials: 'include' })
            const escrowData = await escrowRes.json().catch(() => ({}))
            const escrowAddress = escrowData?.address
            if (!escrowRes.ok || !escrowAddress) {
              const errMsg =
                typeof escrowData?.error === 'string' && escrowData.error.trim()
                  ? escrowData.error.trim()
                  : 'Prize escrow is not configured on this server.'
              alert(
                `${errMsg} Your raffle is saved as a draft. ` +
                  'Please contact an admin, or try again once escrow is configured.'
              )
              router.push(`/raffles/${raffle.slug}?deposit=1`)
              return
            }
            const escrowPubkey = new PublicKey(escrowAddress)

            const depositLogCtx = {
              raffleId: raffle.id,
              raffleSlug: raffle.slug,
              nftMint: raffle.nft_mint_address,
              transferAssetId: selectedNft.mint,
              escrowAddress,
              fromWallet: publicKey.toBase58(),
            }
            logEscrowDepositStart({
              ...depositLogCtx,
              dbPrizeStandard: raffle.prize_standard ?? null,
              displayLabel: selectedNft.name,
            })

            // Mobile RPC can lag behind the NFT list API — retry like the raffle page deposit flow.
            let resolvedHolder: NftHolderInWallet | null = null
            if (selectedNft?.tokenAccount) {
              try {
                const selectedTokenAccount = new PublicKey(selectedNft.tokenAccount)
                const selectedInfo = await connection.getParsedAccountInfo(selectedTokenAccount, 'processed')
                const ownerProgram = selectedInfo.value?.owner
                const isSplProgram = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
                const isToken2022 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
                const info = (selectedInfo.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined)?.parsed?.info
                const selectedMint = typeof info?.mint === 'string' ? info.mint : null
                const amountRaw =
                  typeof info?.tokenAmount === 'object' && info?.tokenAmount
                    ? (info.tokenAmount as { amount?: unknown }).amount
                    : undefined
                const amount =
                  typeof amountRaw === 'string'
                    ? Number(amountRaw)
                    : typeof amountRaw === 'number'
                      ? amountRaw
                      : 0
                const delegate = typeof info?.delegate === 'string' ? info.delegate : null
                if (selectedMint === mintPk.toBase58() && amount >= 1 && !delegate) {
                  if (isSplProgram) {
                    resolvedHolder = { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: selectedTokenAccount }
                  } else if (isToken2022) {
                    resolvedHolder = { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: selectedTokenAccount }
                  }
                }
              } catch {
                // Fall through to holder lookup retries.
              }
            }
            const maxHolderAttempts = 10
            for (let attempt = 0; attempt < maxHolderAttempts; attempt++) {
              if (resolvedHolder) break
              const h = await getNftHolderInWallet(connection, mintPk, publicKey, 'processed')
              if (h && 'delegated' in h && h.delegated) {
                alert(
                  'This NFT is staked or delegated. Unstake it, then complete the deposit from the raffle page (your draft is saved).'
                )
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
              if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
                resolvedHolder = h
                break
              }
              if (attempt < maxHolderAttempts - 1) {
                await new Promise((r) => setTimeout(r, 700))
              }
            }

            let depositSig: string | null = null
            let lastMplCoreEscrowError: string | null = null

            if (resolvedHolder) {
              const { tokenProgram, tokenAccount: sourceTokenAccount } = resolvedHolder
              if (walletAdapter && tokenProgram.equals(TOKEN_PROGRAM_ID)) {
                try {
                  logEscrowDepositPath(depositLogCtx, 'token_metadata')
                  depositSig = await transferTokenMetadataNftToEscrow({
                    connection,
                    wallet: walletAdapter,
                    mintAddress: raffle.nft_mint_address,
                    escrowAddress,
                  })
                  logEscrowDepositSigned(depositLogCtx, 'token_metadata', depositSig)
                } catch (tmErr) {
                  logEscrowDepositAbort(depositLogCtx, 'token_metadata_failed_trying_spl', {
                    detail: tmErr instanceof Error ? tmErr.message : String(tmErr),
                  })
                  depositSig = null
                }
              }
              if (!depositSig) {
                if (!sendTransaction) {
                  logEscrowDepositAbort(depositLogCtx, 'no_send_transaction_after_token_metadata')
                  alert(
                    'Your wallet did not expose a transaction sender. Open your raffle and complete the deposit there, or try another wallet.'
                  )
                  router.push(`/raffles/${raffle.slug}?deposit=1`)
                  return
                }
                const escrowAta = await getAssociatedTokenAddress(
                  mintPk,
                  escrowPubkey,
                  false,
                  tokenProgram,
                  ASSOCIATED_TOKEN_PROGRAM_ID
                )
                const tx = new Transaction()
                try {
                  await getAccount(connection, escrowAta, 'confirmed', tokenProgram)
                } catch {
                  tx.add(
                    createAssociatedTokenAccountInstruction(
                      publicKey,
                      escrowAta,
                      escrowPubkey,
                      mintPk,
                      tokenProgram,
                      ASSOCIATED_TOKEN_PROGRAM_ID
                    )
                  )
                }
                tx.add(
                  createTransferInstruction(
                    sourceTokenAccount,
                    escrowAta,
                    publicKey,
                    1n,
                    [],
                    tokenProgram
                  )
                )
                logEscrowDepositPath(depositLogCtx, 'spl_transfer', {
                  tokenProgram: tokenProgram.toBase58(),
                  sourceTokenAccount: sourceTokenAccount.toBase58(),
                  escrowAta: escrowAta.toBase58(),
                })
                depositSig = await sendTransaction(tx, connection)
                await confirmSignatureSuccessOnChain(connection, depositSig)
                logEscrowDepositSigned(depositLogCtx, 'spl_transfer', depositSig)
              }
            } else if (walletAdapter) {
              try {
                logEscrowDepositPath(depositLogCtx, 'fallback_compressed', {
                  note: 'No SPL holder resolved; trying compressed',
                })
                depositSig = await transferCompressedNftToEscrow({
                  connection,
                  wallet: walletAdapter,
                  assetId: selectedNft.mint,
                  escrowAddress,
                })
                logEscrowDepositSigned(depositLogCtx, 'fallback_compressed', depositSig)
              } catch (cErr) {
                logEscrowDepositAbort(depositLogCtx, 'fallback_compressed_failed', {
                  detail: cErr instanceof Error ? cErr.message : String(cErr),
                })
                depositSig = null
              }
              if (!depositSig) {
                try {
                  logEscrowDepositPath(depositLogCtx, 'fallback_mpl_core')
                  depositSig = await transferMplCoreToEscrow({
                    connection,
                    wallet: walletAdapter,
                    assetId: selectedNft.mint,
                    escrowAddress,
                  })
                  logEscrowDepositSigned(depositLogCtx, 'fallback_mpl_core', depositSig)
                } catch (coreErr) {
                  const coreMsg = coreErr instanceof Error ? coreErr.message : String(coreErr)
                  lastMplCoreEscrowError = coreMsg
                  logEscrowDepositAbort(depositLogCtx, 'fallback_mpl_core_failed', {
                    detail: coreMsg,
                  })
                  depositSig = null
                }
              }
              if (!depositSig) {
                logEscrowDepositAbort(depositLogCtx, 'no_path_create_form')
                const mintShort =
                  selectedNft.mint.length > 16
                    ? `${selectedNft.mint.slice(0, 4)}…${selectedNft.mint.slice(-4)}`
                    : selectedNft.mint
                if (
                  lastMplCoreEscrowError &&
                  isMplCoreNoApprovalsError(lastMplCoreEscrowError)
                ) {
                  alert(
                    mplCoreNoApprovalsEscrowMessage(mintShort, {
                      fullAssetId: selectedNft.mint,
                    })
                  )
                } else {
                  alert(
                    'We could not send this NFT to escrow from here (tried compressed, Metaplex Core, and SPL). ' +
                      'Your raffle is saved — open it to deposit or verify, or try Wi‑Fi / another network.'
                  )
                }
                router.push(`/raffles/${raffle.slug}?deposit=1`)
                return
              }
            } else {
              logEscrowDepositAbort(depositLogCtx, 'no_wallet_adapter_for_core_compressed')
              alert(
                'We could not confirm this NFT as SPL in your wallet yet, and the wallet adapter is not ready for Core/compressed transfers. ' +
                  'Open your raffle when ready and tap deposit.'
              )
              router.push(`/raffles/${raffle.slug}?deposit=1`)
              return
            }

            const verifyResult = await verifyPrizeDepositWithRetries(raffle.id, { depositTx: depositSig })
            logEscrowDepositVerify(
              depositLogCtx,
              verifyResult.ok,
              verifyResult.ok ? undefined : verifyResult.error
            )
            if (!verifyResult.ok && verifyResult.status === 401) {
              alert(
                'Your session expired. Sign in from your dashboard, then open your raffle and tap Verify deposit if needed.'
              )
              router.push('/dashboard')
              return
            }
            if (!verifyResult.ok) {
              if (isEscrowSplPrizeFrozenVerifyError(verifyResult.error)) {
                const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
                const d = verifyResult.frozenEscrowDiagnostics
                const links = d
                  ? `\n\nEscrow token account (must be thawed on-chain):\nhttps://solscan.io/account/${encodeURIComponent(d.escrowTokenAccount)}${q}`
                  : ''
                alert(verifyResult.error + links)
              } else {
                alert(
                  'Your transfer may have succeeded, but the server has not confirmed escrow yet (common on mobile RPC). ' +
                    'Open your raffle — tap Verify deposit once if it does not activate within a minute.'
                )
              }
              router.push(`/raffles/${raffle.slug}?deposit=1`)
              return
            }
            router.push(`/raffles/${raffle.slug}`)
          } catch (transferErr) {
            logEscrowDepositError(
              {
                raffleId: raffle.id,
                raffleSlug: raffle.slug,
                nftMint: raffle.nft_mint_address,
                transferAssetId: selectedNft.mint,
                fromWallet: publicKey.toBase58(),
              },
              transferErr
            )
            console.error('NFT transfer to escrow failed:', transferErr)
            alert(
              transferErr instanceof Error ? transferErr.message : 'Transfer to escrow failed. You can complete it on the raffle page.'
            )
            router.push(`/raffles/${raffle.slug}?deposit=1`)
          }
        } else if (raffle.prize_type === 'nft' && raffle.nft_mint_address) {
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
      setCreateStep('idle')
    }
  }

  const borderStyle = getThemeAccentBorderStyle(themeAccent)

  if (!connected || !publicKey) {
    return (
      <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
        <CardHeader>
          <CardTitle>Create a raffle</CardTitle>
          <CardDescription>
            Connect your wallet to create an NFT raffle. Sign in from your dashboard first so we can save your raffle.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={getThemeAccentClasses(themeAccent)} style={borderStyle}>
      <CardHeader>
        <CardTitle>Raffle Details</CardTitle>
        <CardDescription>
          Pick your prize NFT and details, tap create — we save your raffle, then your wallet opens so you can sign
          one transaction to send the NFT to escrow. After that, the raffle can go live (or on your start date).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <p><strong>Platform fee (deducted from every ticket sale):</strong> 3% for Owltopia (Owl NFT) holders, 6% for non-holders. The fee is taken from each ticket payment at purchase time.</p>
        </div>

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

          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <Label>NFT prize (from your wallet)</Label>
              <p className="text-xs text-muted-foreground">
                Load your wallet to see NFTs you can use as the raffle prize. The raffle image is taken from the NFT you select.
              </p>
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">Be careful when selecting an NFT</p>
                <p className="text-muted-foreground mt-0.5">
                  Only choose an NFT you intend to give away. Staked or delegated NFTs cannot be used until you unstake them.
                </p>
              </div>
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
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>No NFTs found in this wallet.</p>
                  <p>If you&apos;re on <strong>Devnet</strong>, set Phantom to Devnet and ensure this wallet holds at least one NFT (mint or receive one, then click Load again).</p>
                </div>
              )}
              {walletNfts && walletNfts.length > 0 && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="nft-search" className="text-xs">Search NFTs</Label>
                    <Input
                      id="nft-search"
                      type="text"
                      placeholder="Search by name, collection, or mint…"
                      value={nftSearchQuery}
                      onChange={(e) => setNftSearchQuery(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[280px] overflow-y-auto">
                  {(() => {
                    const q = nftSearchQuery.trim().toLowerCase()
                    const filtered = q
                      ? walletNfts.filter(
                          (nft) =>
                            (nft.name?.toLowerCase().includes(q)) ||
                            (nft.collectionName?.toLowerCase().includes(q)) ||
                            nft.mint.toLowerCase().includes(q)
                        )
                      : walletNfts
                    return filtered.length === 0 ? (
                      <p className="col-span-full text-sm text-muted-foreground py-2">
                        {q ? 'No NFTs match your search.' : 'No NFTs to show.'}
                      </p>
                    ) : (
                      filtered.map((nft) => (
                    <button
                      key={nft.tokenAccount}
                      type="button"
                      onClick={() => {
                        setSelectedNft(nft)
                        setImageUrl(nft.image?.trim() ? nft.image.trim() : null)
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
                            src={getRaffleDisplayImageUrl(nft.image) ?? nft.image}
                            alt={nft.name ?? nft.mint}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const el = e.currentTarget
                              const fallback = nft.image
                              if (fallback && el.src !== fallback) {
                                el.src = fallback
                              }
                            }}
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
                      ))
                    )
                  })()}
                </div>
                </>
              )}
              {selectedNft && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Selected: {selectedNft.name ?? selectedNft.mint}
                  </p>
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                    <p className="font-medium text-foreground">What happens when you tap Create</p>
                    <p className="text-muted-foreground mt-0.5">
                      <strong>1.</strong> Your raffle is saved first, then your wallet asks you to sign (same as before).{' '}
                      <strong>2.</strong> That signature sends the NFT to escrow — network fee + rent for the escrow account are included in that one transaction. No listing fee; platform only earns from ticket sales.{' '}
                      <strong>3.</strong> Once escrow is verified, your raffle can go live on the schedule you set. Winner claims the NFT from escrow when the raffle ends.
                    </p>
                  </div>
                </>
              )}
            </div>

          <div className="rounded-md border border-muted-foreground/25 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Fair listing</p>
            <p className="mt-1">
              The floor price you set is the advertised prize value and revenue threshold. Ticket price is always floor
              ÷ {NFT_RAFFLE_MIN_TICKETS} (fixed draw goal). Misleading listings may be removed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <select
                id="currency"
                name="currency"
                value={raffleCurrency}
                onChange={(e) => setRaffleCurrency(e.target.value)}
                className="flex h-10 w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 touch-manipulation"
                required
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
                {isOwlEnabled() && <option value="OWL">OWL</option>}
              </select>
              <p className="text-xs text-muted-foreground">
                Choose the currency buyers pay in. Floor price must be in this same currency.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ticket_price">Ticket price (auto)</Label>
              <Input
                id="ticket_price"
                name="ticket_price"
                type="number"
                step="any"
                required
                readOnly
                className="text-base sm:text-sm bg-muted/50 touch-manipulation min-h-[44px]"
                value={ticketPrice ?? ''}
                aria-describedby="ticket_price_help"
              />
              <p id="ticket_price_help" className="text-xs text-muted-foreground">
                Floor ÷ {NFT_RAFFLE_MIN_TICKETS} tickets (not editable).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max_tickets">Max Tickets (optional)</Label>
            <Input
              id="max_tickets"
              name="max_tickets"
              type="number"
              min={NFT_RAFFLE_MIN_TICKETS}
              placeholder="Leave empty for unlimited tickets"
              className="min-h-[44px] touch-manipulation"
            />
            <p className="text-xs text-muted-foreground">
              Set a limit on the total number of tickets that can be purchased. Leave empty for unlimited.
            </p>
          </div>

          <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Draw goal:</span>{' '}
            {NFT_RAFFLE_MIN_TICKETS} tickets (fixed). The raffle can draw once this many confirmed tickets are sold.
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
              <Label htmlFor="floor_price">
                Floor price (prize value) *
                {floorPriceLoading && (
                  <span className="ml-2 text-muted-foreground font-normal">Checking marketplace…</span>
                )}
              </Label>
              <Input
                id="floor_price"
                name="floor_price"
                type="text"
                inputMode="decimal"
                className="text-base sm:text-sm touch-manipulation min-h-[44px]"
                value={floorPrice ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  setFloorPrice(v)
                  updateTicketPriceFromFloor(v)
                }}
                placeholder="e.g., 0.25 or 5.5 (same as currency above)"
                required
              />
              <p className="text-xs text-muted-foreground">
                We try to load a suggested price from the marketplace when you pick an NFT; if none appears, enter a fair
                value in <strong className="font-medium text-foreground">{raffleCurrency}</strong>. This sets the revenue
                threshold for rev share.
              </p>
              {floorPriceCurrency &&
                floorPrice &&
                raffleCurrency &&
                floorPriceCurrency.toUpperCase() !== raffleCurrency.toUpperCase() && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Suggested price is in {floorPriceCurrency}; your raffle currency is {raffleCurrency}. Adjust the number
                    if needed so it matches {raffleCurrency}.
                  </p>
                )}
              {floorPriceAutoNote && (
                <p className="text-xs text-muted-foreground">{floorPriceAutoNote}</p>
              )}
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
              <option value="live" disabled>
                Live (NFT requires escrow deposit)
              </option>
              <option value="ready_to_draw" disabled>
                Ready to Draw (NFT requires escrow deposit)
              </option>
              <option value="completed">Completed</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Starts as draft until your wallet approves sending the prize to escrow; then the raffle can go live once verified.
            </p>
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
              <option value="ember">Ember (Warm Orange)</option>
              <option value="violet">Violet (Purple)</option>
              <option value="coral">Coral (Rose)</option>
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
                    // Build max in local time, but base calculations on the UTC conversion to avoid browser parsing quirks.
                    const startUtc = localDateTimeToUtc(startTime)
                    const maxUtc = new Date(startUtc)
                    maxUtc.setUTCDate(maxUtc.getUTCDate() + 7)
                    return utcToLocalDateTime(maxUtc.toISOString())
                  })() : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const baseUtc = startTime ? localDateTimeToUtc(startTime) : new Date().toISOString()
                    const maxUtc = new Date(baseUtc)
                    maxUtc.setUTCDate(maxUtc.getUTCDate() + 7)
                    setEndTime(utcToLocalDateTime(maxUtc.toISOString()))
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
              {loading
                ? createStep === 'signing'
                  ? 'Approve in wallet…'
                  : createStep === 'saving'
                    ? 'Saving raffle…'
                    : 'Working…'
                : 'Create raffle — send prize to escrow'}
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

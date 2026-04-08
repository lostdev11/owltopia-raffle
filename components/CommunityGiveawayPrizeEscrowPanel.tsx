'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  useWallet,
  useConnection,
} from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import type { PrizeStandard } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ExternalLink, Loader2 } from 'lucide-react'

export type CommunityGiveawayEscrowTarget = {
  id: string
  nft_mint_address: string | null
  nft_token_id?: string | null
  prize_standard?: PrizeStandard | string | null
  prize_deposited_at: string | null
}

type Props = {
  giveaway: CommunityGiveawayEscrowTarget
  onUpdated: () => void
}

export function CommunityGiveawayPrizeEscrowPanel({ giveaway, onUpdated }: Props) {
  const walletCtx = useWallet()
  const { publicKey, sendTransaction, connected, wallet, signMessage } = walletCtx
  const walletAdapter = wallet?.adapter ?? null
  const { connection } = useConnection()

  const [depositEscrowLoading, setDepositEscrowLoading] = useState(false)
  const [depositEscrowError, setDepositEscrowError] = useState<string | null>(null)
  const [depositEscrowSuccess, setDepositEscrowSuccess] = useState(false)
  const [showManualEscrowFallback, setShowManualEscrowFallback] = useState(false)
  const [manualDepositTx, setManualDepositTx] = useState('')
  const [depositVerifyLoading, setDepositVerifyLoading] = useState(false)
  const [escrowAddress, setEscrowAddress] = useState<string | null>(null)
  const [showEscrowConfirmDialog, setShowEscrowConfirmDialog] = useState(false)

  const nftMint = giveaway.nft_mint_address?.trim() || null
  const prizeDeposited = !!giveaway.prize_deposited_at

  useEffect(() => {
    if (prizeDeposited || !nftMint) return
    let cancelled = false
    fetch('/api/config/prize-escrow')
      .then((r) => (cancelled ? undefined : r.ok ? r.json() : undefined))
      .then((data: { address?: string } | undefined) => {
        if (!cancelled && data?.address) setEscrowAddress(data.address)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [prizeDeposited, nftMint])

  useEffect(() => {
    setDepositEscrowSuccess(false)
    setDepositEscrowError(null)
    setShowManualEscrowFallback(false)
    setManualDepositTx('')
  }, [giveaway.id, prizeDeposited])

  const verifyUrl = `/api/admin/community-giveaways/${encodeURIComponent(giveaway.id)}/verify-prize-deposit`

  const handleTransferNftToEscrow = useCallback(async () => {
    if (!publicKey || !escrowAddress || !nftMint) return
    setShowEscrowConfirmDialog(false)
    setDepositEscrowError(null)
    setShowManualEscrowFallback(false)
    setDepositEscrowLoading(true)

    const confirmAndAssertSuccess = async (signature: string) => {
      const started = Date.now()
      const timeoutMs = 45_000
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      while (Date.now() - started < timeoutMs) {
        try {
          const tx = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          })
          if (tx?.meta) {
            if (tx.meta.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`)
            }
            return
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.toLowerCase().includes('transaction failed')) throw e
        }

        try {
          const st = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          })
          const s = st?.value?.[0]
          if (s?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`)
          }
          if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
            return
          }
        } catch {
          // retry
        }

        await sleep(900)
      }

      throw new Error(
        'Transaction signature was returned, but it was not confirmed on-chain in time. Please check your wallet activity and retry.'
      )
    }

    const signInForSession = async (): Promise<boolean> => {
      if (!publicKey || !signMessage) {
        setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
        return false
      }
      try {
        const walletAddr = publicKey.toBase58()
        const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
          credentials: 'include',
        })
        if (!nonceRes.ok) {
          const data = await nonceRes.json().catch(() => ({}))
          setDepositEscrowError(typeof data?.error === 'string' ? data.error : 'Failed to get sign-in nonce')
          return false
        }
        const { message } = (await nonceRes.json()) as { message: string }
        const messageBytes = new TextEncoder().encode(message)
        const signature = await signMessage(messageBytes)
        const signatureBase64 =
          typeof signature === 'string'
            ? btoa(signature)
            : btoa(String.fromCharCode(...new Uint8Array(signature)))

        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            wallet: walletAddr,
            message,
            signature: signatureBase64,
          }),
        })
        if (!verifyRes.ok) {
          const data = await verifyRes.json().catch(() => ({}))
          setDepositEscrowError(
            typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
          )
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
        return false
      }
    }

    const verifyDepositAfterTransfer = async (depositTx?: string) => {
      try {
        const body = depositTx ? JSON.stringify({ deposit_tx: depositTx }) : undefined
        let res = await fetch(verifyUrl, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
          credentials: 'include',
        })
        if (res.status === 401) {
          const signedIn = await signInForSession()
          if (!signedIn) return false
          res = await fetch(verifyUrl, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
            credentials: 'include',
          })
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setDepositEscrowError(typeof data?.error === 'string' ? data.error : 'Verification failed')
          return false
        }
        return true
      } catch (e) {
        setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
        return false
      }
    }

    const finalizeAfterTransfer = async (depositTx?: string) => {
      const verified = await verifyDepositAfterTransfer(depositTx)
      setDepositEscrowSuccess(true)
      if (verified) {
        setDepositEscrowError(null)
        onUpdated()
      }
    }

    const mint = new PublicKey(nftMint)
    const escrowPubkey = new PublicKey(escrowAddress)
    const standard: PrizeStandard = (giveaway.prize_standard as PrizeStandard) ?? 'spl'
    const transferAssetId =
      typeof giveaway.nft_token_id === 'string' && giveaway.nft_token_id.trim()
        ? giveaway.nft_token_id.trim()
        : nftMint
    const mintShort =
      transferAssetId.length > 16 ? `${transferAssetId.slice(0, 4)}…${transferAssetId.slice(-4)}` : transferAssetId

    let tokenMetadataEscrowError: string | null = null
    try {
      if (standard === 'mpl_core') {
        if (!walletAdapter) {
          setDepositEscrowError('Wallet adapter not ready for Core transfer. Refresh and try again.')
          return
        }
        const sig = await transferMplCoreToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await confirmAndAssertSuccess(sig)
        await finalizeAfterTransfer(sig)
        return
      }

      if (standard === 'compressed') {
        if (!walletAdapter) {
          setDepositEscrowError(
            'Wallet adapter not ready for compressed NFT transfer. Refresh and try again.'
          )
          return
        }
        const sig = await transferCompressedNftToEscrow({
          connection,
          wallet: walletAdapter,
          assetId: transferAssetId,
          escrowAddress,
        })
        await confirmAndAssertSuccess(sig)
        await finalizeAfterTransfer(sig)
        return
      }

      let holder = await getNftHolderInWallet(connection, mint, publicKey)
      for (let attempt = 0; attempt < 4 && !holder; attempt++) {
        await new Promise((r) => setTimeout(r, 800))
        holder = await getNftHolderInWallet(connection, mint, publicKey)
      }
      if (!holder) {
        let transferFallbackDetails: string | null = null
        if (giveaway.prize_standard !== 'mpl_core' && walletAdapter) {
          try {
            const sig = await transferCompressedNftToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await confirmAndAssertSuccess(sig)
            await finalizeAfterTransfer(sig)
            return
          } catch (e) {
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
          }
          try {
            const sig = await transferMplCoreToEscrow({
              connection,
              wallet: walletAdapter,
              assetId: transferAssetId,
              escrowAddress,
            })
            await confirmAndAssertSuccess(sig)
            await finalizeAfterTransfer(sig)
            return
          } catch (e) {
            transferFallbackDetails = e instanceof Error ? e.message : String(e)
          }
        }
        const detailsSuffix = transferFallbackDetails ? ` Details: ${transferFallbackDetails}` : ''
        setDepositEscrowError(
          `We could not build an automatic transfer transaction for this NFT in-app (mint: ${mintShort}). Send the NFT to the escrow address below from your wallet app, then tap Verify deposit.${detailsSuffix}`
        )
        setShowManualEscrowFallback(true)
        return
      }
      if ('delegated' in holder && holder.delegated) {
        setDepositEscrowError(
          'This NFT is currently staked or delegated. Unstake and retry, or send manually to escrow then Verify deposit.'
        )
        setShowManualEscrowFallback(true)
        return
      }
      if (!('tokenProgram' in holder) || !('tokenAccount' in holder)) {
        setDepositEscrowError('NFT holder data incomplete. Try again.')
        return
      }
      const { tokenProgram, tokenAccount: sourceTokenAccount } = holder

      if (
        walletAdapter &&
        (tokenProgram.equals(TOKEN_PROGRAM_ID) || tokenProgram.equals(TOKEN_2022_PROGRAM_ID))
      ) {
        try {
          const sig = await transferTokenMetadataNftToEscrow({
            connection,
            wallet: walletAdapter,
            mintAddress: nftMint,
            escrowAddress,
          })
          await confirmAndAssertSuccess(sig)
          await finalizeAfterTransfer(sig)
          return
        } catch (metaErr) {
          tokenMetadataEscrowError = metaErr instanceof Error ? metaErr.message : String(metaErr)
        }
      }

      const escrowAta = await getAssociatedTokenAddress(
        mint,
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
            mint,
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
      const sig = await sendTransaction(tx, connection)
      await confirmAndAssertSuccess(sig)
      await finalizeAfterTransfer(sig)
    } catch (e) {
      const baseMessage = e instanceof Error ? e.message : 'Transfer failed'
      const metaHint = tokenMetadataEscrowError
        ? ` Metaplex Token Metadata transfer was tried first and failed: ${tokenMetadataEscrowError}`
        : ''
      setDepositEscrowError(baseMessage + metaHint)
      setShowManualEscrowFallback(true)
    } finally {
      setDepositEscrowLoading(false)
    }
  }, [
    publicKey,
    signMessage,
    escrowAddress,
    nftMint,
    giveaway.nft_token_id,
    giveaway.prize_standard,
    giveaway.id,
    connection,
    sendTransaction,
    verifyUrl,
    walletAdapter,
    onUpdated,
  ])

  const handleVerifyPrizeDeposit = useCallback(async () => {
    setDepositEscrowError(null)
    setDepositVerifyLoading(true)
    const manualTx = manualDepositTx.trim()
    try {
      const signInForSession = async (): Promise<boolean> => {
        if (!publicKey || !signMessage) {
          setDepositEscrowError('Sign in required. Connect your wallet and sign in.')
          return false
        }
        try {
          const walletAddr = publicKey.toBase58()
          const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
            credentials: 'include',
          })
          if (!nonceRes.ok) {
            const data = await nonceRes.json().catch(() => ({}))
            setDepositEscrowError(typeof data?.error === 'string' ? data.error : 'Failed to get nonce')
            return false
          }
          const { message } = (await nonceRes.json()) as { message: string }
          const messageBytes = new TextEncoder().encode(message)
          const signature = await signMessage(messageBytes)
          const signatureBase64 =
            typeof signature === 'string'
              ? btoa(signature)
              : btoa(String.fromCharCode(...new Uint8Array(signature)))
          const verifyRes = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              wallet: walletAddr,
              message,
              signature: signatureBase64,
            }),
          })
          if (!verifyRes.ok) {
            const data = await verifyRes.json().catch(() => ({}))
            setDepositEscrowError(
              typeof data?.error === 'string' ? data.error : 'Sign-in verification failed'
            )
            return false
          }
          return true
        } catch (e) {
          setDepositEscrowError(e instanceof Error ? e.message : 'Sign-in failed')
          return false
        }
      }

      const verifyBody = manualTx ? JSON.stringify({ deposit_tx: manualTx }) : undefined
      let res = await fetch(verifyUrl, {
        method: 'POST',
        headers: verifyBody ? { 'Content-Type': 'application/json' } : undefined,
        body: verifyBody,
        credentials: 'include',
      })
      if (res.status === 401) {
        const signedIn = await signInForSession()
        if (!signedIn) return
        res = await fetch(verifyUrl, {
          method: 'POST',
          headers: verifyBody ? { 'Content-Type': 'application/json' } : undefined,
          body: verifyBody,
          credentials: 'include',
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDepositEscrowError(typeof data?.error === 'string' ? data.error : 'Verification failed')
        return
      }
      onUpdated()
    } catch (e) {
      setDepositEscrowError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setDepositVerifyLoading(false)
    }
  }, [publicKey, signMessage, manualDepositTx, verifyUrl, onUpdated])

  if (!nftMint) {
    return null
  }

  const cluster = /devnet/i.test(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? '') ? '?cluster=devnet' : ''
  const ps = giveaway.prize_standard
  const explorerMintUrl =
    ps === 'mpl_core' || ps === 'compressed'
      ? `https://solscan.io/account/${nftMint}${cluster}`
      : `https://solscan.io/token/${nftMint}${cluster}`

  if (prizeDeposited) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-3 text-sm text-green-800 dark:text-green-300 mt-4 space-y-2">
        <p className="font-medium">Prize verified in platform escrow.</p>
        <a
          href={explorerMintUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px]"
        >
          View prize on Solscan
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </a>
      </div>
    )
  }

  return (
    <>
      <Card className="border-amber-500/50 bg-amber-500/5 mt-4">
        <CardHeader>
          <CardTitle className="text-lg">Prize in escrow required</CardTitle>
          <CardDescription>
            Same flow as NFT raffles: transfer the prize NFT to the platform escrow wallet, then verify on-chain. After
            verification, use <strong>Open / live</strong> to publish the giveaway.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!connected && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Connect the admin wallet that holds the prize NFT to transfer it to escrow.
            </p>
          )}
          {!escrowAddress && connected && <p className="text-sm text-muted-foreground">Preparing…</p>}
          {escrowAddress && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setShowEscrowConfirmDialog(true)}
                  disabled={!connected || depositEscrowLoading}
                  className="touch-manipulation min-h-[44px]"
                >
                  {depositEscrowLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    'Transfer NFT to escrow'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleVerifyPrizeDeposit()}
                  disabled={depositVerifyLoading}
                  className="touch-manipulation min-h-[44px]"
                  title="Checks on-chain that the NFT is in platform escrow"
                >
                  {depositVerifyLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    'Verify deposit'
                  )}
                </Button>
              </div>
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  If in-app transfer does not work (e.g. some compressed NFTs), send manually to escrow, then Verify
                  deposit.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs break-all rounded bg-background/80 px-2 py-1">{escrowAddress}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs touch-manipulation min-h-[44px] sm:min-h-8"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(escrowAddress)
                        setDepositEscrowError(null)
                      } catch {
                        setDepositEscrowError('Could not copy escrow address.')
                      }
                    }}
                  >
                    Copy escrow address
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`manual-deposit-tx-${giveaway.id}`} className="text-xs">
                    Deposit transaction signature (optional)
                  </Label>
                  <Input
                    id={`manual-deposit-tx-${giveaway.id}`}
                    value={manualDepositTx}
                    onChange={(e) => setManualDepositTx(e.target.value)}
                    placeholder="Paste Solana tx signature if escrow holds multiple NFTs"
                    className="text-xs sm:text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto touch-manipulation min-h-[44px]"
                    onClick={() => void handleVerifyPrizeDeposit()}
                    disabled={depositVerifyLoading || manualDepositTx.trim().length === 0}
                  >
                    {depositVerifyLoading ? 'Submitting…' : 'Submit signature & verify'}
                  </Button>
                </div>
              </div>
              {explorerMintUrl && (
                <a
                  href={explorerMintUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1 touch-manipulation min-h-[44px]"
                >
                  View prize on Solscan
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              )}
            </>
          )}
          {depositEscrowSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">
              Transfer submitted. If verify did not succeed yet, tap Verify deposit again after confirmation.
            </p>
          )}
          {depositEscrowError && <p className="text-sm text-destructive">{depositEscrowError}</p>}
          {showManualEscrowFallback && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Manual path: transfer NFT to escrow in your wallet app, then Verify deposit.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEscrowConfirmDialog} onOpenChange={setShowEscrowConfirmDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer NFT to escrow?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  You are about to send this NFT to the platform escrow wallet. Your wallet will prompt you to sign.
                </p>
                <p>
                  The NFT stays in escrow for this community giveaway until a winner is chosen and the prize is sent
                  out.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowEscrowConfirmDialog(false)}
              disabled={depositEscrowLoading}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleTransferNftToEscrow()} disabled={depositEscrowLoading}>
              {depositEscrowLoading ? 'Sending…' : 'Yes, transfer to escrow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

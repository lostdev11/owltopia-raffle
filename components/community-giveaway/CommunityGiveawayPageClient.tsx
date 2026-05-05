'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { PublicKey, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type {
  CommunityGiveawayMeStatusPayload,
  PublicCommunityGiveawayPageInfo,
} from '@/lib/community-giveaways/page-data'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { GiveawayShareButton } from '@/components/GiveawayShareButton'
import { Gift, Loader2, Users } from 'lucide-react'
import { buildRaffleImageAttemptChain } from '@/lib/raffle-display-image-url'

export type CommunityGiveawayPageClientProps = {
  giveawayId: string
  initialPublicInfo: PublicCommunityGiveawayPageInfo
  sessionWallet: string | null
  initialMeStatus: CommunityGiveawayMeStatusPayload | null
}

export function CommunityGiveawayPageClient({
  giveawayId: id,
  initialPublicInfo,
  sessionWallet,
  initialMeStatus,
}: CommunityGiveawayPageClientProps) {
  const { connected, publicKey, signMessage } = useWallet()
  const sendTransaction = useSendTransactionForWallet()
  const { connection } = useConnection()

  const [info, setInfo] = useState<PublicCommunityGiveawayPageInfo>(initialPublicInfo)
  /** Personal row only after wallet connects (matches pre-SSR behavior). */
  const [status, setStatus] = useState<CommunityGiveawayMeStatusPayload | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [boosting, setBoosting] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [nftImageAttemptChain, setNftImageAttemptChain] = useState<string[]>([])
  const [nftImageAttemptIdx, setNftImageAttemptIdx] = useState(0)
  const [nftImageLoading, setNftImageLoading] = useState(true)

  useEffect(() => {
    setInfo(initialPublicInfo)
  }, [initialPublicInfo])

  const loadPublic = useCallback(async () => {
    if (!id) return
    setRefreshError(null)
    try {
      const res = await fetch(`/api/public/community-giveaways/${id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRefreshError(typeof json?.error === 'string' ? json.error : 'Could not refresh giveaway')
        return
      }
      setInfo(json as PublicCommunityGiveawayPageInfo)
    } catch {
      setRefreshError('Could not refresh giveaway')
    }
  }, [id])

  const loadStatus = useCallback(async () => {
    if (!id || !publicKey) {
      setStatus(null)
      setNeedsSignIn(false)
      return
    }
    const addr = publicKey.toBase58()
    try {
      const res = await fetch(`/api/me/community-giveaways/${id}/status`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Connected-Wallet': addr },
      })
      if (res.status === 401) {
        setStatus(null)
        setNeedsSignIn(true)
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus(null)
        return
      }
      setNeedsSignIn(false)
      setStatus(json as CommunityGiveawayMeStatusPayload)
    } catch {
      setStatus(null)
    }
  }, [id, publicKey])

  useEffect(() => {
    if (!id || !publicKey) {
      setStatus(null)
      setNeedsSignIn(false)
      return
    }
    const addr = publicKey.toBase58()
    if (sessionWallet && addr === sessionWallet && initialMeStatus) {
      setStatus(initialMeStatus)
      setNeedsSignIn(false)
      return
    }
    void loadStatus()
  }, [id, publicKey, sessionWallet, initialMeStatus, loadStatus])

  useEffect(() => {
    let cancelled = false
    const mint = info.nft_mint_address?.trim()
    if (!mint) {
      setNftImageAttemptChain([])
      setNftImageAttemptIdx(0)
      setNftImageLoading(false)
      return
    }
    setNftImageLoading(true)
    setNftImageAttemptIdx(0)
    setNftImageAttemptChain([])
    fetch(`/api/nft/metadata-image?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { image?: string | null } | null) => {
        if (cancelled) return
        const raw = json?.image?.trim()
        if (!raw) {
          setNftImageAttemptChain([])
          return
        }
        setNftImageAttemptChain(buildRaffleImageAttemptChain(raw, null))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setNftImageLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [info.nft_mint_address])

  const handleSignIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setSignInError('Your wallet does not support message signing.')
      return
    }
    setSignInError(null)
    setSigningIn(true)
    try {
      const walletAddr = publicKey.toBase58()
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${encodeURIComponent(walletAddr)}`, {
        credentials: 'include',
      })
      if (!nonceRes.ok) {
        const data = await nonceRes.json().catch(() => ({}))
        throw new Error((data as { error?: string })?.error || 'Failed to get sign-in nonce')
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
        throw new Error((data as { error?: string })?.error || 'Sign-in verification failed')
      }

      await loadStatus()
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSigningIn(false)
    }
  }, [publicKey, signMessage, loadStatus])

  const handleJoin = async () => {
    if (!publicKey || !id) return
    setActionError(null)
    setJoining(true)
    try {
      const addr = publicKey.toBase58()
      const res = await fetch(`/api/me/community-giveaways/${id}/join`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Connected-Wallet': addr },
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setNeedsSignIn(true)
        setActionError('Sign in with your wallet to participate.')
        return
      }
      if (!res.ok) {
        setActionError(typeof json?.error === 'string' ? json.error : 'Could not join')
        return
      }
      await loadPublic()
      await loadStatus()
    } finally {
      setJoining(false)
    }
  }

  const handleOwlBoost = async () => {
    if (!publicKey || !id || !info.owlPayment || !connected) return
    setActionError(null)
    setBoosting(true)
    try {
      const addr = publicKey.toBase58()
      const { treasuryWallet, mint, decimals, uiAmount } = info.owlPayment
      const owlMint = new PublicKey(mint)
      const treasuryPk = new PublicKey(treasuryWallet)
      const amount = BigInt(Math.round(uiAmount * Math.pow(10, decimals)))

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      })

      const senderAta = await getAssociatedTokenAddress(owlMint, publicKey)
      const recipientAta = await getAssociatedTokenAddress(owlMint, treasuryPk)

      let treasuryAtaReady = false
      try {
        await getAccount(connection, recipientAta)
        treasuryAtaReady = true
      } catch {
        treasuryAtaReady = false
      }
      if (!treasuryAtaReady) {
        transaction.add(
          createAssociatedTokenAccountInstruction(publicKey, recipientAta, treasuryPk, owlMint)
        )
      }
      transaction.add(createTransferInstruction(senderAta, recipientAta, publicKey, amount, []))

      const signature = await sendTransaction(transaction, connection, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      })

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      )

      const res = await fetch(`/api/me/community-giveaways/${id}/owl-boost`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Connected-Wallet': addr },
        body: JSON.stringify({ signature }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(typeof json?.error === 'string' ? json.error : 'Could not verify OWL boost')
        return
      }
      await loadStatus()
      await loadPublic()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Boost failed'
      if (msg.includes('rejected') || msg.includes('cancelled')) {
        setActionError('Transaction was cancelled.')
      } else {
        setActionError(msg)
      }
    } finally {
      setBoosting(false)
    }
  }

  const title = info.title?.trim() || 'Community giveaway'

  return (
    <main className="container mx-auto px-4 py-8 max-w-lg">
      <Card className="overflow-hidden border-green-500/20">
        <div className="relative w-full aspect-square min-h-[200px] overflow-hidden bg-muted sm:min-h-0">
          {!nftImageLoading &&
          nftImageAttemptChain.length > 0 &&
          nftImageAttemptIdx < nftImageAttemptChain.length ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote NFT URIs via proxy / fallback chain
            <img
              key={`nft-${nftImageAttemptIdx}-${nftImageAttemptChain[nftImageAttemptIdx]?.slice(0, 48)}`}
              src={nftImageAttemptChain[nftImageAttemptIdx]}
              alt={`${title} — prize NFT`}
              className="h-full w-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="sync"
              onError={() => setNftImageAttemptIdx((i) => i + 1)}
            />
          ) : nftImageLoading ? (
            <div className="flex h-full min-h-[200px] w-full items-center justify-center text-muted-foreground sm:min-h-0">
              <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] w-full items-center justify-center bg-green-500/10 sm:min-h-0">
              <Gift className="h-16 w-16 text-green-500/70 sm:h-20 sm:w-20" aria-hidden />
            </div>
          )}
        </div>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Gift className="h-6 w-6 shrink-0" />
            {title}
          </CardTitle>
          <CardDescription>
            Join the pool for a chance to win. Holder-only giveaways require an Owltopia (Owl NFT) in your wallet.
            Before the scheduled start time, you can send OWL to the raffle treasury wallet in separate transactions —{' '}
            {info.owlBoostUiAmount ?? 1} OWL adds +1 draw weight each time (up to {info.maxDrawWeight ?? 4} total
            weight, after you have joined). You can stop after one extra boost or use up to three.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {refreshError && <p className="text-sm text-destructive">{refreshError}</p>}
          <>
            {info.description?.trim() ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{info.description.trim()}</p>
            ) : null}
            <ul className="text-sm text-muted-foreground space-y-2">
              <li className="flex items-center gap-2">
                <Users className="h-4 w-4 shrink-0" />
                Entries: <span className="text-foreground font-medium">{info.entryCount}</span>
              </li>
              <li>
                Access:{' '}
                <span className="text-foreground font-medium">
                  {info.access_gate === 'holder_only' ? 'Owl NFT holders' : 'Everyone'}
                </span>
              </li>
              <li>
                Status:{' '}
                <span className="text-foreground font-medium">
                  {info.status === 'open'
                    ? 'Open'
                    : info.status === 'draft'
                      ? 'Draft'
                      : info.status === 'drawn'
                        ? info.claimed
                          ? 'Completed'
                          : 'Winner drawn'
                        : info.status}
                </span>
              </li>
              <li>
                Starts at (OWL boost deadline):{' '}
                <span className="text-foreground font-medium">
                  {new Date(info.starts_at).toLocaleString()}
                </span>
              </li>
              {info.ends_at && (
                <li>
                  Entry deadline:{' '}
                  <span className="text-foreground font-medium">
                    {new Date(info.ends_at).toLocaleString()}
                  </span>
                </li>
              )}
              {!info.prizeDeposited && info.status !== 'draft' && (
                <li className="text-amber-600 dark:text-amber-500">
                  Prize not verified in escrow yet — joins stay closed until the team verifies.
                </li>
              )}
              {info.winnerDrawn && (
                <li className="text-foreground">
                  A winner has been drawn. If you won, open your dashboard to claim the NFT from escrow.
                </li>
              )}
            </ul>

            {status && (
              <div className="rounded-md border border-border/60 p-3 text-sm space-y-1">
                <p>
                  Your status:{' '}
                  <span className="font-medium text-foreground">
                    {status.joined ? 'Entered' : 'Not entered'}
                  </span>
                  {status.joined && status.drawWeight != null ? (
                    <span className="text-muted-foreground"> · Draw weight: {status.drawWeight}</span>
                  ) : null}
                </p>
                {status.joined && status.drawWeight != null && status.drawWeight >= status.maxDrawWeight && (
                  <p className="text-muted-foreground">Draw weight is at the maximum ({status.maxDrawWeight}).</p>
                )}
                {status.isWinner ? (
                  <p className="text-foreground font-medium">
                    You won — claim from your dashboard (mobile: stable connection recommended).
                  </p>
                ) : null}
              </div>
            )}

            {actionError && <p className="text-sm text-destructive">{actionError}</p>}

            <div className="flex flex-col gap-3 pt-2 touch-manipulation">
              <GiveawayShareButton
                title={title}
                giveawayId={id}
                imageUrl={
                  !nftImageLoading &&
                  nftImageAttemptChain.length > 0 &&
                  nftImageAttemptIdx < nftImageAttemptChain.length
                    ? nftImageAttemptChain[nftImageAttemptIdx]
                    : null
                }
                endTime={info.ends_at}
                isCommunityGiveaway
              />
              <div className="min-h-[44px] [&_button]:min-h-[44px] [&_button]:w-full">
                <WalletConnectButton />
              </div>

              {connected && publicKey && needsSignIn && (
                <div className="space-y-2">
                  {signInError && <p className="text-sm text-destructive">{signInError}</p>}
                  <Button
                    type="button"
                    className="min-h-[44px] w-full"
                    onClick={() => void handleSignIn()}
                    disabled={signingIn || !signMessage}
                  >
                    {signingIn ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Signing in…
                      </>
                    ) : (
                      'Sign in to participate'
                    )}
                  </Button>
                </div>
              )}

              {connected && publicKey && !needsSignIn && info.status === 'open' && info.prizeDeposited && (
                <>
                  {!status?.joined ? (
                    <Button
                      type="button"
                      className="min-h-[44px] w-full"
                      onClick={() => void handleJoin()}
                      disabled={joining}
                    >
                      {joining ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Joining…
                        </>
                      ) : (
                        'Join giveaway'
                      )}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">You are in this giveaway.</p>
                  )}

                  {status?.joined &&
                    info.owlBoostWindowOpen &&
                    info.owlPayment &&
                    status.canOwlBoostMore && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-[44px] w-full"
                        onClick={() => void handleOwlBoost()}
                        disabled={boosting || !connected || !publicKey}
                      >
                        {boosting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Sending OWL…
                          </>
                        ) : (
                          `Pay ${info.owlBoostUiAmount} OWL for +1 draw weight`
                        )}
                      </Button>
                    )}
                </>
              )}

              <Button asChild variant="outline" className="min-h-[44px] w-full">
                <Link href="/dashboard">Open dashboard (claim wins)</Link>
              </Button>
              <Button asChild variant="ghost" className="min-h-[44px] w-full">
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </>
        </CardContent>
      </Card>
    </main>
  )
}

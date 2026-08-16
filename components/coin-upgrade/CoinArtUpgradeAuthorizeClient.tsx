'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { CheckCircle2, Loader2, Sparkles, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { authorizeCoinArtUpgradeDelegateInWallet } from '@/lib/coin-upgrade/client/authorize-delegate'
import { OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY } from '@/lib/coin-upgrade/collection'
import { cn } from '@/lib/utils'

type DelegateStatus = {
  collection: string
  update_authority: string
  expected_update_authority: string
  hot_wallet: string | null
  hot_wallet_configured: boolean
  authorized: boolean
  additional_delegates: string[]
  authority_matches_expected: boolean
}

function shorten(addr: string): string {
  if (addr.length < 12) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

/**
 * Gembird-friendly one-button authorize: connect the collection update-authority
 * wallet in Phantom and approve a single UpdateDelegate transaction. No CLI,
 * no pasting secrets.
 */
export function CoinArtUpgradeAuthorizeClient({ embedded = false }: { embedded?: boolean }) {
  const { connection } = useConnection()
  const { publicKey, connected, wallet } = useWallet()
  const { setVisible } = useWalletModal()
  const sendTransaction = useSendTransactionForWallet()

  const [status, setStatus] = useState<DelegateStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    null
  )

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/coin-upgrade/delegate-status', { cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as (DelegateStatus & { error?: string }) | null
      if (!res.ok || !json || json.error) {
        throw new Error(json?.error || 'Could not load authorize status.')
      }
      setStatus(json)
      return json
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load authorize status.')
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connectedB58 = publicKey?.toBase58() ?? ''
  const isUpdateAuthority =
    Boolean(connectedB58) &&
    Boolean(status?.update_authority) &&
    connectedB58 === status?.update_authority

  const handleAuthorize = useCallback(async () => {
    if (!status?.hot_wallet || !publicKey || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await authorizeCoinArtUpgradeDelegateInWallet({
        connection,
        wallet: wallet?.adapter ?? wallet,
        ownerWallet: publicKey.toBase58(),
        collectionAddress: status.collection,
        hotWallet: status.hot_wallet,
        sendTransaction,
      })
      if (result.alreadyAuthorized) {
        setNotice({ tone: 'success', text: 'Already authorized — nothing else to do. Thanks!' })
      } else {
        setNotice({
          tone: 'success',
          text: `Done! Owltopia can now update coin art. Signature ${shorten(result.signature)}.`,
        })
      }
      await refresh()
    } catch (e) {
      setNotice({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Authorize failed. Try again or ask Devdad.',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, connection, publicKey, refresh, sendTransaction, status, wallet])

  const card = (
      <div className={cn('rounded-2xl border border-border/60 bg-card/80 p-6 space-y-5', !embedded && '')}>
        <div className="flex items-start gap-3">
          <Sparkles className="h-8 w-8 text-theme-prime shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <h1 className={cn(embedded ? 'text-xl' : 'text-2xl', 'font-semibold tracking-tight')}>
              Authorize coin art upgrades
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              One wallet approval lets Owltopia update Owltopia Coin art when holders pay for the
              upgrade. Your collection key stays in your wallet — never shared.
            </p>
          </div>
        </div>

        {loadError ? (
          <p className="text-sm text-destructive rounded-lg border border-destructive/40 px-3 py-2">
            {loadError}
          </p>
        ) : !status ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Checking on-chain status…
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border/60 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground">Collection</p>
              <p className="font-mono text-xs break-all">{status.collection}</p>
            </div>
            <div className="rounded-lg border border-border/60 px-3 py-2 space-y-1">
              <p className="text-xs text-muted-foreground">Must connect this wallet</p>
              <p className="font-mono text-xs break-all">
                {status.update_authority || OWLTOPIA_COIN_COLLECTION_UPDATE_AUTHORITY}
              </p>
            </div>
            {!status.hot_wallet_configured ? (
              <p className="text-sm text-amber-500 rounded-lg border border-amber-500/40 px-3 py-2">
                Owltopia has not configured the upgrade hot key yet. Ask Devdad to set{' '}
                <span className="font-mono text-xs">COIN_ART_UPGRADE_AUTHORITY_WALLET</span> first,
                then refresh this page.
              </p>
            ) : status.authorized ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-emerald-500">
                <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
                <div>
                  <p className="font-medium">Already authorized</p>
                  <p className="text-xs text-emerald-500/90 mt-1">
                    Hot key {shorten(status.hot_wallet!)} can update coin art. You can close this
                    page.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border/60 px-3 py-2 space-y-1">
                <p className="text-xs text-muted-foreground">Will authorize this Owltopia key</p>
                <p className="font-mono text-xs break-all">{status.hot_wallet}</p>
              </div>
            )}
          </div>
        )}

        {notice ? (
          <p
            className={cn(
              'text-xs rounded-lg border px-3 py-2 leading-relaxed',
              notice.tone === 'success' && 'border-emerald-500/40 text-emerald-500',
              notice.tone === 'info' && 'border-border/60 text-muted-foreground',
              notice.tone === 'error' && 'border-destructive/50 text-destructive'
            )}
          >
            {notice.text}
          </p>
        ) : null}

        {!connected || !publicKey ? (
          <Button
            type="button"
            className="min-h-[52px] w-full touch-manipulation text-base"
            onClick={() => setVisible(true)}
          >
            <Wallet className="h-4 w-4 mr-2" aria-hidden />
            Connect wallet
          </Button>
        ) : status?.authorized ? (
          <Button type="button" variant="outline" className="min-h-[52px] w-full" disabled>
            All set
          </Button>
        ) : !status?.hot_wallet_configured ? (
          <Button type="button" variant="outline" className="min-h-[52px] w-full" disabled>
            Waiting on Owltopia setup
          </Button>
        ) : !isUpdateAuthority ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-500 leading-relaxed">
              Connected {shorten(connectedB58)} — switch Phantom to the collection wallet above,
              then come back here.
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-[52px] w-full touch-manipulation"
              onClick={() => setVisible(true)}
            >
              Switch wallet
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            className="min-h-[52px] w-full touch-manipulation text-base"
            disabled={busy}
            onClick={() => void handleAuthorize()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
            Approve in Phantom
          </Button>
        )}

        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Open this page on your phone or computer.</li>
          <li>Connect the Owltopia Coins collection wallet in Phantom.</li>
          <li>Tap Approve — one small network fee, then you&apos;re done.</li>
        </ol>

        {!embedded ? (
          <p className="text-xs text-muted-foreground text-center">
            <Link href="/" className="text-theme-prime underline-offset-4 hover:underline">
              Back to Owltopia
            </Link>
          </p>
        ) : null}
      </div>
  )

  if (embedded) return card
  return <main className="relative mx-auto max-w-lg px-4 py-10 safe-area-bottom">{card}</main>
}

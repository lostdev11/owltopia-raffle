'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, Loader2, Trash2, Wallet } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { Button } from '@/components/ui/button'
import { useWalletLink } from '@/hooks/use-wallet-link'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { cn } from '@/lib/utils'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

type ClusterResponse = {
  session_wallet?: string
  primary_wallet?: string
  is_primary?: boolean
  linked_wallets?: { linked_wallet: string }[]
  cluster_wallets?: string[]
  max_links?: number
  error?: string
}

function shortWallet(w: string): string {
  if (w.length <= 12) return w
  return `${w.slice(0, 4)}…${w.slice(-4)}`
}

type Props = {
  connected: boolean
  sessionWalletHint: string | null
  onClusterChange?: () => void
  className?: string
}

export function Gen2LinkedWalletsPanel({
  connected,
  sessionWalletHint,
  onClusterChange,
  className,
}: Props) {
  const { publicKey } = useWallet()
  const connectedWallet = publicKey?.toBase58() ?? null
  const { signIn, signingIn } = useSiwsSignIn()
  const { linkConnectedWallet, linking, error: linkError, clearError } = useWalletLink()

  const [cluster, setCluster] = useState<ClusterResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/me/wallet-links', { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as ClusterResponse
      if (!res.ok) {
        if (res.status === 401) {
          setCluster(null)
          setFetchError('Sign in with your primary wallet to manage linked wallets.')
          return
        }
        throw new Error(data.error || 'Could not load linked wallets')
      }
      setCluster(data)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Could not load linked wallets')
      setCluster(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connected) void refresh()
    else {
      setCluster(null)
      setFetchError(null)
    }
  }, [connected, refresh, sessionWalletHint])

  const handleLink = useCallback(async () => {
    clearError()
    setStatusMsg(null)
    const primary = cluster?.primary_wallet
    if (!primary) return
    const ok = await linkConnectedWallet(primary)
    if (ok) {
      setStatusMsg('Wallet linked. Presale and whitelist on this address count toward Discord roles.')
      await refresh()
      onClusterChange?.()
    }
  }, [cluster?.primary_wallet, linkConnectedWallet, clearError, refresh, onClusterChange])

  const handleRemove = useCallback(
    async (linked: string) => {
      setStatusMsg(null)
      setRemoving(linked)
      try {
        const res = await fetch(
          `/api/me/wallet-links?linked_wallet=${encodeURIComponent(linked)}`,
          { method: 'DELETE', credentials: 'include' }
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || 'Remove failed')
        setStatusMsg('Wallet unlinked.')
        await refresh()
        onClusterChange?.()
      } catch (e) {
        setStatusMsg(e instanceof Error ? e.message : 'Remove failed')
      } finally {
        setRemoving(null)
      }
    },
    [refresh, onClusterChange]
  )

  const primary = cluster?.primary_wallet ?? null
  const linkedList = cluster?.linked_wallets ?? []
  const maxLinks = cluster?.max_links ?? 5
  const atLimit = linkedList.length >= maxLinks
  const isPrimary = cluster?.is_primary === true

  const connectedNorm = connectedWallet ? normalizeSolanaWalletAddress(connectedWallet) : null
  const primaryNorm = primary ? normalizeSolanaWalletAddress(primary) : null
  const canLinkThisWallet =
    isPrimary &&
    connectedNorm &&
    primaryNorm &&
    !walletsEqualSolana(connectedNorm, primaryNorm) &&
    !linkedList.some((r) => walletsEqualSolana(r.linked_wallet, connectedNorm)) &&
    !atLimit

  return (
    <div
      className={cn(
        'rounded-xl border border-[#1F6F54]/60 bg-[#10161C]/80 px-4 py-4',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-[#00FF9C]" aria-hidden />
        <h3 className="font-semibold text-[#EAFBF4]">Linked wallets</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#A9CBB9]">
        Presale on one wallet and whitelist on another? Link them to your{' '}
        <strong className="text-[#EAFBF4]">primary</strong> wallet (the one you sign in with). Each
        linked wallet must sign once to prove you control it.
      </p>

      {fetchError ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-amber-100">{fetchError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch-manipulation min-h-[44px] border-[#1F6F54] text-[#EAFBF4]"
            disabled={signingIn}
            onClick={() => void signIn().then(() => refresh())}
          >
            {signingIn ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Signing in…
              </>
            ) : (
              'Sign in with Owltopia'
            )}
          </Button>
        </div>
      ) : loading && !cluster ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[#A9CBB9]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : cluster ? (
        <div className="mt-3 space-y-3">
          <div className="text-sm">
            <p className="text-[#A9CBB9]">
              Primary:{' '}
              <span className="font-mono text-[#EAFBF4]">{primary ? shortWallet(primary) : '—'}</span>
            </p>
            {!isPrimary && primary ? (
              <p className="mt-1 text-xs text-amber-100">
                You are signed in with a linked wallet. Sign in with{' '}
                <span className="font-mono">{shortWallet(primary)}</span> to add or remove links, or
                claim Discord from the primary account below.
              </p>
            ) : null}
          </div>

          {linkedList.length > 0 ? (
            <ul className="space-y-2">
              {linkedList.map((row) => (
                <li
                  key={row.linked_wallet}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#1F6F54]/50 bg-[#151D24]/60 px-3 py-2"
                >
                  <span className="flex items-center gap-2 font-mono text-xs text-[#EAFBF4]">
                    <Wallet className="h-3.5 w-3.5 text-[#00FF9C]" aria-hidden />
                    {shortWallet(row.linked_wallet)}
                  </span>
                  {isPrimary ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="touch-manipulation min-h-[44px] min-w-[44px] text-[#A9CBB9] hover:text-red-300"
                      disabled={removing === row.linked_wallet}
                      onClick={() => void handleRemove(row.linked_wallet)}
                      aria-label={`Unlink ${row.linked_wallet}`}
                    >
                      {removing === row.linked_wallet ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[#A9CBB9]">No linked wallets yet.</p>
          )}

          {isPrimary && !atLimit ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                className="touch-manipulation min-h-[44px] w-full sm:w-auto bg-[#00E58B]/20 border border-[#00FF9C]/30 text-[#EAFBF4] hover:bg-[#00E58B]/35"
                disabled={!canLinkThisWallet || linking}
                onClick={() => void handleLink()}
              >
                {linking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Verifying…
                  </>
                ) : (
                  'Link connected wallet'
                )}
              </Button>
              <p className="text-xs text-[#A9CBB9] sm:flex-1">
                {canLinkThisWallet
                  ? `Will link ${shortWallet(connectedNorm!)} (${linkedList.length}/${maxLinks} slots)`
                  : 'Connect a different wallet than your primary, then tap link.'}
              </p>
            </div>
          ) : null}

          {isPrimary && atLimit ? (
            <p className="text-xs text-[#A9CBB9]">Maximum linked wallets reached ({maxLinks}).</p>
          ) : null}
        </div>
      ) : null}

      {linkError ? <p className="mt-2 text-sm text-red-300">{linkError}</p> : null}
      {statusMsg ? (
        <p className="mt-2 text-sm text-[#00FF9C]" role="status">
          {statusMsg}
        </p>
      ) : null}
    </div>
  )
}

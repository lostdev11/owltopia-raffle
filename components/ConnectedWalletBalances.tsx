'use client'

import { useState } from 'react'
import type { PublicKey } from '@solana/web3.js'
import { Wallet } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWalletHeaderBalances } from '@/lib/hooks/useWalletHeaderBalances'
import { isOwlEnabled } from '@/lib/tokens'

function fmtAmount(amount: number | null, loading: boolean, maxFrac: number): string {
  if (loading && amount === null) return '…'
  if (amount === null || !Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0,
  }).format(amount)
}

export interface ConnectedWalletBalancesProps {
  walletIcon?: string | null
  walletName: string
  publicKey: PublicKey
  onDisconnect: () => void | Promise<void>
}

export function ConnectedWalletBalances({
  walletIcon,
  walletName,
  publicKey,
  onDisconnect,
}: ConnectedWalletBalancesProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const { sol, usdc, owl, loading, error, refresh } = useWalletHeaderBalances()
  const owlOn = isOwlEnabled()
  const address = publicKey.toBase58()
  const shortAddress = `${address.slice(0, 4)}…${address.slice(-4)}`

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    } catch {
      // ignore
    }
  }

  const disconnect = async () => {
    setMenuOpen(false)
    await onDisconnect()
  }

  return (
    <>
      <button
        type="button"
        className="flex min-h-11 min-w-0 max-w-full touch-manipulation items-center gap-2 rounded-lg border border-green-500/40 bg-black/80 px-2 py-1.5 text-left text-white shadow-sm outline-none ring-green-500/30 transition hover:border-green-500/60 focus-visible:ring-2 sm:gap-2.5 sm:px-2.5"
        onClick={() => setMenuOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Wallet ${walletName}, balances and options`}
      >
        {walletIcon ? (
          // eslint-disable-next-line @next/next/no-img-element -- adapter icons are often data: URLs
          <img
            src={walletIcon}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-600/30">
            <Wallet className="h-4 w-4 text-green-400" aria-hidden />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight sm:flex-row sm:items-center sm:gap-2">
          <span className="truncate text-[10px] font-medium text-green-400/90 sm:text-xs">{walletName}</span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-200 sm:text-xs">
            <span className="whitespace-nowrap" title="SOL">
              <span className="text-zinc-500">SOL </span>
              {fmtAmount(sol, loading, 4)}
            </span>
            <span className="hidden h-3 w-px bg-zinc-600 sm:inline" aria-hidden />
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title="USDC">
              <Image src="/usdc.png" alt="" width={12} height={12} className="inline h-3 w-3 shrink-0" />
              {fmtAmount(usdc, loading, 2)}
            </span>
            {owlOn && (
              <>
                <span className="hidden h-3 w-px bg-zinc-600 sm:inline" aria-hidden />
                <span className="inline-flex items-center gap-0.5 whitespace-nowrap" title="OWL">
                  <Image
                    src="/owl%20token%20v1.png"
                    alt=""
                    width={12}
                    height={12}
                    className="inline h-3 w-3 shrink-0 rounded-full object-cover"
                  />
                  {fmtAmount(owl, loading, 2)}
                </span>
              </>
            )}
          </div>
        </div>
        {error && <span className="sr-only">Balances could not be loaded</span>}
      </button>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="border-green-500/20 bg-zinc-950 text-zinc-100 sm:max-w-md" style={{ zIndex: 10000 }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              {walletIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={walletIcon} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover" />
              ) : (
                <Wallet className="h-8 w-8 text-green-400" />
              )}
              {walletName}
            </DialogTitle>
            <DialogDescription className="text-left text-zinc-400">
              <span className="font-mono text-sm text-zinc-200">{address}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="rounded-lg border border-green-500/20 bg-black/50 p-3 text-sm">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Balances</div>
              <ul className="space-y-2">
                <li className="flex justify-between gap-2">
                  <span className="text-zinc-400">SOL</span>
                  <span className="font-mono text-green-100">{fmtAmount(sol, loading, 6)}</span>
                </li>
                <li className="flex justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-zinc-400">
                    <Image src="/usdc.png" alt="" width={16} height={16} className="h-4 w-4" />
                    USDC
                  </span>
                  <span className="font-mono text-green-100">{fmtAmount(usdc, loading, 6)}</span>
                </li>
                {owlOn && (
                  <li className="flex justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-zinc-400">
                      <Image
                        src="/owl%20token%20v1.png"
                        alt=""
                        width={16}
                        height={16}
                        className="h-4 w-4 rounded-full object-cover"
                      />
                      OWL
                    </span>
                    <span className="font-mono text-green-100">{fmtAmount(owl, loading, 6)}</span>
                  </li>
                )}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="touch-manipulation" onClick={() => void refresh()}>
                Refresh
              </Button>
              <Button type="button" variant="outline" size="sm" className="touch-manipulation" onClick={() => void copyAddress()}>
                {copyDone ? 'Copied' : 'Copy address'}
              </Button>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              type="button"
              variant="destructive"
              className="w-full touch-manipulation"
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
            <p className="text-center text-xs text-zinc-500">
              Connected as <span className="font-mono text-zinc-400">{shortAddress}</span>
            </p>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

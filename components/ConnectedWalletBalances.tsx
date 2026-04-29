'use client'

import { useState } from 'react'
import type { PublicKey } from '@solana/web3.js'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
        className="flex min-h-11 min-w-0 max-w-full touch-manipulation items-center gap-2 rounded-lg border border-green-500/40 bg-black/80 px-2 py-1.5 text-left text-white shadow-sm outline-none ring-green-500/30 transition hover:border-green-500/60 focus-visible:ring-2 sm:gap-2.5 sm:px-2.5 md:min-h-10 md:gap-3 md:px-3 md:py-2"
        onClick={() => setMenuOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Wallet ${walletName}, ${shortAddress}, options`}
      >
        {walletIcon ? (
          // eslint-disable-next-line @next/next/no-img-element -- adapter icons are often data: URLs
          <img
            src={walletIcon}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 shrink-0 rounded-md object-cover md:h-8 md:w-8"
            loading="lazy"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-600/30 md:h-8 md:w-8">
            <Wallet className="h-4 w-4 text-green-400 md:h-5 md:w-5" aria-hidden />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight sm:flex-row sm:items-center sm:gap-2 md:gap-3">
          <span className="truncate text-[10px] font-medium text-green-400/90 sm:text-xs md:text-sm">{walletName}</span>
          <span className="font-mono text-[10px] text-zinc-300 sm:text-xs md:text-sm">{shortAddress}</span>
        </div>
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
              <span className="font-mono text-sm text-zinc-200 break-all">{address}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 py-2">
            <Button type="button" variant="outline" size="sm" className="touch-manipulation" onClick={() => void copyAddress()}>
              {copyDone ? 'Copied' : 'Copy address'}
            </Button>
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

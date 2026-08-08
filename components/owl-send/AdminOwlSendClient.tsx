'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowLeft, CheckCircle2, Loader2, Send, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { OwlSendClient } from '@/components/owl-send/OwlSendClient'
import {
  OWL_SEND_MAX_PER_TX,
  OWL_SEND_MAX_SELECT,
} from '@/lib/owl-send/constants'
import { formatOwlSendFeeSol, getOwlSendFeeSol, isOwlSendFeeEnabledClient } from '@/lib/owl-send/fee'
import { useOwlSendAdminAccess } from '@/lib/owl-send/use-owl-send-admin-access'

type Props = {
  initialViewerIsAdmin: boolean
  isPublic: boolean
}

export function AdminOwlSendClient({ initialViewerIsAdmin, isPublic }: Props) {
  const { publicKey, connected } = useWallet()
  const access = useOwlSendAdminAccess({ initialViewerIsAdmin, isPublic })

  const feeSol = getOwlSendFeeSol()
  const feeConfigured = isOwlSendFeeEnabledClient()

  if (access.loading) {
    return (
      <div className="container mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking admin access…
      </div>
    )
  }

  if (!connected || !publicKey) {
    // SIWS admin session still allows opening the bench after reconnect prompts.
    if (access.isAdmin) {
      return (
        <div className="container mx-auto max-w-3xl px-4 py-10 pb-24">
          <AdminChrome isPublic={isPublic} feeSol={feeSol} feeConfigured={feeConfigured} />
          <Card className="mt-6 border-white/10 bg-black/40">
            <CardHeader>
              <CardTitle className="text-lg">Reconnect your admin wallet</CardTitle>
              <CardDescription>
                Your admin session is active. Connect the same wallet to load NFTs and run a send.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WalletConnectButton />
            </CardContent>
          </Card>
        </div>
      )
    }
    return (
      <div className="container mx-auto max-w-3xl px-4 py-10 pb-24">
        <AdminChrome isPublic={isPublic} feeSol={feeSol} feeConfigured={feeConfigured} />
        <Card className="mt-6 border-white/10 bg-black/40">
          <CardHeader>
            <CardTitle className="text-lg">Connect an admin wallet</CardTitle>
            <CardDescription>
              OwlSend admin testing is limited to site admins. Connect, then run a small send.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (access.denied) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>Only admins can open the OwlSend test bench.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="min-h-[44px]" asChild>
              <Link href="/admin">Back to Owl Vision</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!access.allowed) {
    return (
      <div className="container mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking admin access…
      </div>
    )
  }

  return (
    <div className="pb-24">
      <div className="container mx-auto max-w-3xl px-4 pt-8">
        <AdminChrome isPublic={isPublic} feeSol={feeSol} feeConfigured={feeConfigured} />
        <Card className="mt-4 border-amber-500/30 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-100">
              <Shield className="h-4 w-4" />
              Test checklist
            </CardTitle>
            <CardDescription className="text-amber-100/80">
              Use small amounts on mobile wallet (Phantom / Solflare). Fee + NFT move in the same
              approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-amber-50/90">
            <ChecklistItem>
              Send 1 NFT to your own wallet (Send to one)
            </ChecklistItem>
            <ChecklistItem>
              Scatter 2 NFTs to 2 wallets — confirm pairing + batch of {OWL_SEND_MAX_PER_TX}
            </ChecklistItem>
            <ChecklistItem>
              Tokens → Scatter — paste wallets (or wallet,amount) and confirm Solscan success
            </ChecklistItem>
            <ChecklistItem>
              Scatter → <strong>Lint CSV</strong> with airdrop.csv (simple lint before send; gated
              until <code className="text-xs">OWL_SEND_CSV_PUBLIC=true</code>)
            </ChecklistItem>
            <ChecklistItem>
              Confirm fee treasury receives {formatOwlSendFeeSol(feeSol)} per line
            </ChecklistItem>
            {!isPublic ? (
              <ChecklistItem>
                When ready: set <code className="text-xs">OWL_SEND_PUBLIC=true</code> and{' '}
                <code className="text-xs">NEXT_PUBLIC_OWL_SEND_PUBLIC=true</code>
              </ChecklistItem>
            ) : (
              <ChecklistItem>Public flag is on — holders can use /owl-send</ChecklistItem>
            )}
          </CardContent>
        </Card>
      </div>

      <OwlSendClient initialViewerIsAdmin isPublic={isPublic} />
    </div>
  )
}

function AdminChrome({
  isPublic,
  feeSol,
  feeConfigured,
}: {
  isPublic: boolean
  feeSol: number
  feeConfigured: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <Link
        href="/admin"
        aria-label="Back to Owl Vision"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-accent touch-manipulation"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl tracking-wide text-theme-prime sm:text-3xl">
          <Send className="h-6 w-6" />
          OwlSend admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Live send test bench — same UI as{' '}
          <Link href="/owl-send" className="text-primary underline-offset-4 hover:underline">
            /owl-send
          </Link>
          . Max {OWL_SEND_MAX_SELECT} NFTs / session, {OWL_SEND_MAX_PER_TX} per approval.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusPill ok={feeConfigured}>
            Fee {formatOwlSendFeeSol(feeSol)}
            {feeConfigured ? '' : ' — treasury not set'}
          </StatusPill>
          <StatusPill ok={isPublic}>
            {isPublic ? 'Public' : 'Admin-only preview'}
          </StatusPill>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={
        ok
          ? 'rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-100'
          : 'rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-100'
      }
    >
      {children}
    </span>
  )
}

function ChecklistItem({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/80" />
      <span>{children}</span>
    </div>
  )
}

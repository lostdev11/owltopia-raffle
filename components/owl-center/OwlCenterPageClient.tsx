'use client'

import Link from 'next/link'
import { Rocket, Sparkles, Wallet } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { Gen2ElectricBorder } from '@/components/gen2-presale/Gen2ElectricBorder'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Button } from '@/components/ui/button'
import { useGen2PresaleBalance } from '@/hooks/use-gen2-presale-balance'
import { cn } from '@/lib/utils'

export function OwlCenterPageClient() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const { balance, loading: balanceLoading, error: balanceError } = useGen2PresaleBalance(wallet)

  const available = balance?.available_mints ?? 0
  const hasCredits = available > 0
  const totalCredits = (balance?.purchased_mints ?? 0) + (balance?.gifted_mints ?? 0)

  return (
    <div className="relative min-h-[70vh] bg-[#0B0F12] text-[#EAFBF4]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(0,229,139,0.18),transparent)]"
        aria-hidden
      />
      <main className="relative mx-auto max-w-2xl px-4 py-10 pb-24 sm:py-14">
        <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#00FF9C]/40 bg-[#00E58B]/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#00FF9C]">
            <Rocket className="h-3.5 w-3.5" aria-hidden />
            Coming soon
          </span>
          <h1 className="mt-4 font-display text-4xl tracking-tight text-[#EAFBF4] sm:text-5xl">Owl Center</h1>
          <p className="mt-3 text-lg font-semibold text-[#00FF9C]">Gen2 mint opens here</p>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#A9CBB9]">
            Owl Center is the home for Owltopia Gen2 minting. When mint goes live, connect the same wallet you used
            during presale and redeem your credits — one presale spot equals one Gen2 mint.
          </p>
        </div>

        <Gen2ElectricBorder className="mt-10">
          <div className="rounded-2xl border border-[#00E58B]/25 bg-[#151D24]/95 p-6 shadow-[inset_0_0_40px_rgba(0,229,139,0.06)]">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[#EAFBF4]">
              <Sparkles className="h-5 w-5 text-[#00FF9C]" aria-hidden />
              What to expect
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[#A9CBB9]">
              <li className="flex gap-2">
                <span className="text-[#00FF9C]">✓</span>
                Mint with SOL from your connected wallet (Phantom, Solflare, and other Solana wallets).
              </li>
              <li className="flex gap-2">
                <span className="text-[#00FF9C]">✓</span>
                Presale credits you already hold will be redeemable here — no extra token required.
              </li>
              <li className="flex gap-2">
                <span className="text-[#00FF9C]">✓</span>
                New presale spots are no longer sold once supply is gone — only minting with credits you already have.
              </li>
            </ul>
          </div>
        </Gen2ElectricBorder>

        <section className="mt-8" aria-labelledby="owl-center-credits-heading">
          <h2 id="owl-center-credits-heading" className="sr-only">
            Your presale credits
          </h2>
          {!connected ? (
            <div className="rounded-2xl border border-[#1F6F54]/50 bg-[#10161C]/90 p-6">
              <p className="flex items-center gap-2 text-sm font-medium text-[#EAFBF4]">
                <Wallet className="h-4 w-4 text-[#00FF9C]" aria-hidden />
                Connect to preview your mint credits
              </p>
              <p className="mt-2 text-sm text-[#A9CBB9]">
                Use the same wallet you used on the Gen2 presale. On mobile, your wallet app will open to approve the
                connection.
              </p>
              <div className="mt-5">
                <WalletConnectButton />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#00E58B]/30 bg-[#151D24]/95 p-6">
              <p className="text-sm text-[#A9CBB9]">Connected wallet</p>
              <p className="mt-1 truncate font-mono text-xs text-[#EAFBF4]/90">{wallet}</p>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#00E58B]/15">
                  <dt className="text-xs uppercase tracking-wider text-[#A9CBB9]">Available to mint</dt>
                  <dd className="mt-1 text-3xl font-black tabular-nums text-[#00FF9C]">
                    {balanceLoading ? '…' : available}
                  </dd>
                </div>
                <div className="rounded-xl bg-[#10161C]/80 p-4 ring-1 ring-[#00E58B]/15">
                  <dt className="text-xs uppercase tracking-wider text-[#A9CBB9]">Purchased + gifted</dt>
                  <dd className="mt-1 text-3xl font-black tabular-nums text-[#EAFBF4]">
                    {balanceLoading ? '…' : totalCredits}
                  </dd>
                </div>
              </dl>
              {balanceError && (
                <p
                  className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100"
                  role="alert"
                >
                  {balanceError}. Sign in from Dashboard if credits do not load.
                </p>
              )}
              {hasCredits && (
                <p className="mt-4 text-sm text-[#A9CBB9]">
                  You have{' '}
                  <strong className="text-[#EAFBF4]">
                    {available} mint credit{available === 1 ? '' : 's'}
                  </strong>{' '}
                  ready for Owl Center when mint opens.
                </p>
              )}
              {!balanceLoading && !hasCredits && !balanceError && (
                <p className="mt-4 text-sm text-[#A9CBB9]">
                  No presale credits on this wallet yet. If you bought spots, try{' '}
                  <Link
                    href="/gen2-presale"
                    className="font-semibold text-[#00FF9C] underline-offset-2 hover:underline"
                  >
                    Gen2 presale
                  </Link>{' '}
                  to sync or record a payment.
                </p>
              )}
            </div>
          )}
        </section>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            disabled
            className={cn(
              'h-12 min-h-[48px] w-full touch-manipulation border border-[#1F6F54] bg-[#10161C] text-base font-bold text-[#A9CBB9] sm:w-auto',
              'cursor-not-allowed opacity-90'
            )}
          >
            Mint Gen2 — not live yet
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-12 min-h-[48px] w-full touch-manipulation border-[#00FF9C]/40 bg-transparent text-base font-semibold text-[#EAFBF4] hover:bg-[#00E58B]/10 sm:w-auto"
          >
            <Link href="/gen2-presale">Gen2 presale &amp; balance</Link>
          </Button>
        </div>

        <p className="mt-8 text-center text-xs text-[#A9CBB9]/80 sm:text-left">
          We will announce when Owl Center mint is live. Until then, presale purchases stay closed once supply is sold
          out.
        </p>
      </main>
    </div>
  )
}

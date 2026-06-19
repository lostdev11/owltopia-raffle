import type { Metadata } from 'next'
import Link from 'next/link'

import { Gen2WalletChecker } from '@/components/owl-center/Gen2WalletChecker'
import { PLATFORM_NAME } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Gen2 Wallet Eligibility Checker | Owl Center | ${PLATFORM_NAME}`,
  description:
    'Check any Solana wallet for Owltopia Gen2 mint eligibility — Airdrop, Presale, Whitelist, and Public phases.',
}

export default async function Gen2WalletCheckerPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string | string[] }>
}) {
  const sp = await searchParams
  const walletParam = Array.isArray(sp.wallet) ? sp.wallet[0] : sp.wallet
  const initialWallet = typeof walletParam === 'string' ? walletParam.trim() : ''

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">gen2_wallet_checker</p>
        <h1 className="font-mono text-xl font-bold uppercase tracking-wide text-[#00FF9C]">
          Gen2 Wallet Eligibility Checker
        </h1>
        <p className="font-mono text-sm leading-relaxed text-[#9BA8B4]">
          Enter any wallet to see which Owltopia Gen2 mint phases it qualifies for.
        </p>
      </div>

      <Gen2WalletChecker initialWallet={initialWallet} />

      <Link
        href="/owl-center/collection/gen2"
        className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-md border border-[#00FF9C]/40 bg-[#00FF9C]/10 px-4 font-mono text-xs uppercase tracking-widest text-[#00FF9C] hover:bg-[#00FF9C]/15"
      >
        Open Gen2 mint center
      </Link>
    </main>
  )
}

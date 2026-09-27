import Link from 'next/link'
import { PLATFORM_NAME } from '@/lib/site-config'
import { StaticPublicFooter } from '@/components/static/StaticPublicFooter'

/**
 * Server-rendered landing copy for crawlers and wallet security scanners (no JS required).
 */
export function StaticLandingAbout() {
  return (
    <section
      className="relative z-10 w-full border-t border-green-500/20 bg-zinc-950 text-zinc-200"
      aria-labelledby="static-landing-about-heading"
    >
      <div className="container mx-auto max-w-3xl px-4 py-10 space-y-6 prose prose-invert prose-p:text-zinc-300">
        <h1 id="static-landing-about-heading" className="text-3xl font-bold text-white mb-2">
          {PLATFORM_NAME}
        </h1>
        <p className="text-lg text-zinc-300">
          Community Solana NFT raffles, Owl Packs, the Owl Center launchpad, and OWL nesting (staking) — built for
          holders and creators who want transparent, on-chain ticket flows.
        </p>
        <h2 className="text-xl font-semibold text-white">What you sign in your wallet</h2>
        <p>
          When you buy raffle tickets, open packs, stake OWL, or use launchpad checkout, your wallet asks you to approve
          a Solana transaction. You always see the recipient address and amount before you confirm. Typical flows:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Raffle tickets:</strong> SOL, USDC, or OWL transfers to the raffle&apos;s published{' '}
            <strong>funds escrow</strong> address (or the address shown on that raffle). A platform fee (3% for Owltopia
            NFT holder creators, 6% otherwise) is part of the published payment flow.
          </li>
          <li>
            <strong>NFT prizes:</strong> creators deposit prizes into <strong>prize escrow</strong> before a draw;
            winners claim through the site after the random draw over confirmed tickets.
          </li>
          <li>
            <strong>Admin / session sign-in:</strong> optional Sign-In with Solana messages for dashboard features — not
            a blanket token approval.
          </li>
        </ul>
        <p>
          Read the full rules on{' '}
          <Link href="/how-it-works" className="text-green-400 underline underline-offset-2">
            How it works
          </Link>{' '}
          and{' '}
          <Link href="/terms" className="text-green-400 underline underline-offset-2">
            Terms of Service
          </Link>
          .
        </p>
      </div>
      <StaticPublicFooter />
    </section>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Ticket, Users, Shield, Percent } from 'lucide-react'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const OG_IMAGE = `${SITE_URL}/opengraph-image`
const OG_ALT = 'Owl Raffle - Trusted raffles with full transparency. Every entry verified on-chain.'

export const metadata: Metadata = {
  title: 'How It Works | Owl Raffle',
  description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
  alternates: { canonical: `${SITE_URL}/how-it-works` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/how-it-works`,
    siteName: 'Owl Raffle',
    title: 'How It Works | Owl Raffle',
    description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How It Works | Owl Raffle',
    description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
    images: [{ url: OG_IMAGE, alt: OG_ALT, width: 1200, height: 630 }],
  },
}

export default function HowItWorksPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <Link href="/raffles">
        <Button variant="ghost" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Raffles
        </Button>
      </Link>

      <div className="prose prose-invert max-w-none">
        <h1 className="text-4xl font-bold mb-2">How It Works</h1>
        <p className="text-muted-foreground mb-8">
          Raffles, winner selection, and the Owl Vision trust score — explained.
        </p>

        {/* How raffles work */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Ticket className="h-6 w-6 text-green-500" />
            How Raffles Work
          </h2>
          <p className="mb-4">
            Every raffle on Owl Raffle follows the same flow so you know exactly what to expect.
          </p>
          <ol className="list-decimal pl-6 mb-4 space-y-3">
            <li>
              <strong>Connect your wallet</strong> — Use a Solana wallet (e.g. Phantom) to participate.
            </li>
            <li>
              <strong>Buy tickets</strong> — You pay in SOL or USDC. The payment is a real on-chain transaction to the raffle&apos;s recipient wallet, so it can be verified on the blockchain.
            </li>
            <li>
              <strong>Entry is recorded</strong> — Your entry is stored with your wallet address and ticket count. Once your payment is verified, your entry counts toward the raffle.
            </li>
            <li>
              <strong>Raffle ends</strong> — When the end time is reached, the raffle closes to new entries. If a minimum ticket count is set, it must be met (or the raffle may be extended).
            </li>
            <li>
              <strong>Winner is selected</strong> — One winner is chosen by <strong>weighted random selection</strong>: your chance of winning is proportional to how many tickets you hold. More tickets = higher chance, but every ticket counts.
            </li>
            <li>
              <strong>Prize delivery</strong> — For NFT prizes, the NFT is transferred to the winner&apos;s wallet and the transaction is recorded for transparency.
            </li>
          </ol>
          <p className="text-muted-foreground text-sm">
            Only <strong>confirmed</strong> entries (verified payments) are included in the draw. Pending or rejected entries do not count.
          </p>
        </section>

        {/* Owl Vision */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Eye className="h-6 w-6 text-green-500" />
            Owl Vision: Why It Exists
          </h2>
          <p className="mb-4">
            Owl Vision is a <strong>trust score (0–100)</strong> shown on each raffle. It exists so you can quickly see how transparent and fair a raffle is — before you buy a ticket.
          </p>
          <p className="mb-4">
            We believe on-chain raffles should be rare in a good way: rare in that they&apos;re verifiable. Owl Vision summarizes three things that matter for trust:
          </p>

          <ul className="list-none pl-0 space-y-4 mb-6">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center font-bold text-sm">1</span>
              <div>
                <strong>Verified payments</strong> (up to 60 points) — What share of entries have been confirmed by on-chain verification? A high percentage means most tickets are backed by real, verified transactions.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center font-bold text-sm">2</span>
              <div>
                <strong>Wallet diversity</strong> (up to 30 points) — Are many different wallets participating, or is it a few wallets with lots of tickets? Higher diversity suggests a broader, more organic participation.
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center font-bold text-sm">3</span>
              <div>
                <strong>Time integrity</strong> (up to 10 points) — Was the raffle edited after people had already entered? If not, the raffle gets full integrity points; if it was edited after entries, it gets fewer points so you&apos;re aware.
              </div>
            </li>
          </ul>

          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-500" />
              How to read the score
            </h3>
            <p className="text-sm text-muted-foreground mb-0">
              Hover or tap the <strong>Owl Vision</strong> badge on any raffle card or detail page to see the breakdown: verified payments %, wallet diversity %, and time integrity. A higher score means more verified entries, better diversity, and no (or minimal) edits after entries — all signals of a trustworthy raffle.
            </p>
          </div>
        </section>

        {/* Rev Share */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Percent className="h-6 w-6 text-green-500" />
            Rev Share
          </h2>
          <p className="mb-4">
            For any ticket sales <strong>after</strong> the raffle&apos;s threshold is met, <strong>50%</strong> goes to the founder and <strong>50%</strong> goes to the community as revenue share. Amounts are shown in <strong>SOL</strong> and <strong>USDC</strong>. This applies to every raffle that hits its minimum.
          </p>
        </section>

        {/* Who can participate */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Users className="h-6 w-6 text-green-500" />
            Who Can Participate
          </h2>
          <p className="mb-4">
            Anyone with a Solana wallet can buy tickets. Raffles are created and managed by approved admins. Winner selection runs automatically when a raffle ends and minimum requirements are met, or can be triggered by an admin. For full legal terms, see our <Link href="/terms" className="text-green-500 hover:underline">Terms of Service</Link>.
          </p>
        </section>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Eye, Ticket, Users, Shield, Percent } from 'lucide-react'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = getDefaultOgImageAbsoluteUrl()

export const metadata: Metadata = {
  title: `How It Works | ${PLATFORM_NAME}`,
  description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
  alternates: { canonical: `${SITE_URL}/how-it-works` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/how-it-works`,
    siteName: PLATFORM_NAME,
    title: `How It Works | ${PLATFORM_NAME}`,
    description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
    images: [{ url: OG_IMAGE, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `How It Works | ${PLATFORM_NAME}`,
    description: 'How raffles work, how winners are chosen, and what Owl Vision trust scoring means for you.',
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
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
            Every raffle on {PLATFORM_NAME} follows the same flow so you know exactly what to expect.
          </p>
          <ol className="list-decimal pl-6 mb-4 space-y-3">
            <li>
              <strong>Connect your wallet</strong> — Use a Solana wallet (Phantom, Solflare, or another compatible app — mobile wallets work the same flow).
            </li>
            <li>
              <strong>Buy tickets</strong> — You pay in <strong>SOL</strong>, <strong>USDC</strong>, or <strong>OWL</strong>, depending on how the raffle is set up. Ticket payments are real on-chain transfers. For most raffles today, proceeds go to a <strong>platform funds escrow</strong> wallet first; the app verifies each payment before your tickets count. Some older raffles may still pay a creator or recipient address directly — check the raffle page for the payment you are signing.
            </li>
            <li>
              <strong>Entry is recorded</strong> — Your entry is stored with your wallet address and ticket count. Once your payment is verified on-chain, your entry counts toward the raffle.
            </li>
            <li>
              <strong>NFT prizes (when applicable)</strong> — For NFT raffles, the prize is deposited to a <strong>prize escrow</strong> wallet before the draw can run. After someone wins, they <strong>claim</strong> the NFT from their dashboard when it is ready (on-chain claim).
            </li>
            <li>
              <strong>Raffle ends</strong> — When the end time is reached, the raffle stops accepting new entries. If a <strong>minimum ticket threshold</strong> is set and it is not met, the end date is usually <strong>extended once</strong> by the same length as the original raffle window (with a 7-day minimum if that length cannot be determined). If the minimum is still not met after that extension, ticket buyers on funds-escrow raffles can <strong>claim refunds</strong> from escrow, and escrowed NFT prizes are returned to the creator when possible.
            </li>
            <li>
              <strong>Winner is selected</strong> — One winning <strong>wallet</strong> is chosen by <strong>weighted random selection</strong> in our backend: your chance is proportional to how many <strong>confirmed</strong> tickets that wallet holds (tickets from the same wallet are combined). The draw is not an on-chain randomness oracle; it is verifiable in the sense that only confirmed entries participate and the rules are applied consistently. Draws run when the raffle has ended, thresholds are satisfied, and (for NFT prizes) the prize is confirmed in escrow — often on a schedule (cron) or when an admin triggers processing.
            </li>
            <li>
              <strong>Prize delivery</strong> — NFT winners claim from escrow as above. For cash or token prizes, settlement depends on raffle setup; creators on funds-escrow raffles typically <strong>claim net proceeds</strong> (after the platform fee) from the dashboard after the draw.
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
            Platform revenue comes from a fee on each ticket sale: <strong>6%</strong> for creators who are not Owltopia (Owl) NFT holders and <strong>3%</strong> for holders. Verified{' '}
            <Link href="/partner-program" className="text-green-500 hover:underline">
              partner program
            </Link>{' '}
            creators pay <strong>2%</strong>. Of that fee revenue, <strong>50%</strong> is allocated to holder rev share. Amounts are tracked in <strong>SOL</strong> and <strong>USDC</strong>; the home page shows the next scheduled rev share when the team has published it.
          </p>
        </section>

        {/* Who can participate */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Users className="h-6 w-6 text-green-500" />
            Who Can Participate
          </h2>
          <p className="mb-4">
            Anyone with a Solana wallet can buy tickets and create raffles. Creators can be holders or non-holders (fees differ as above). After a raffle ends, winner selection and deadline extensions are handled by automated jobs and/or admins according to the rules on this page. For full legal terms, see our <Link href="/terms" className="text-green-500 hover:underline">Terms of Service</Link>.
          </p>
        </section>
      </div>
    </div>
  )
}

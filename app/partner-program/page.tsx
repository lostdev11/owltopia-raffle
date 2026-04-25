import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Coins,
  Headphones,
  LayoutGrid,
  MessageCircle,
  Percent,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PLATFORM_NAME,
  OG_ALT,
  DEFAULT_OG_IMAGE_DIMS,
  DEFAULT_OG_IMAGE_TYPE,
  getSiteBaseUrl,
  getDefaultOgImageAbsoluteUrl,
} from '@/lib/site-config'
import { PARTNER_COMMUNITY_FEE_BPS, STANDARD_FEE_BPS } from '@/lib/config/raffles'

const SITE_URL = getSiteBaseUrl()
const OG_IMAGE = getDefaultOgImageAbsoluteUrl()
const DISCORD_URL = 'https://discord.gg/nRD2wyg2vq'

const partnerFeePercent = PARTNER_COMMUNITY_FEE_BPS / 100
const standardFeePercent = STANDARD_FEE_BPS / 100

export const metadata: Metadata = {
  title: `Partner Program | ${PLATFORM_NAME}`,
  description: `Owltopia Partner Program: collaborate with ${PLATFORM_NAME}, reduced platform fees, partner spotlight, and Discord integration.`,
  alternates: { canonical: `${SITE_URL}/partner-program` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/partner-program`,
    siteName: PLATFORM_NAME,
    title: `Partner Program | ${PLATFORM_NAME}`,
    description: `Owltopia Partner Program — reduced fees, visibility, and tooling for established projects.`,
    images: [{ url: OG_IMAGE, ...DEFAULT_OG_IMAGE_DIMS, alt: OG_ALT, type: DEFAULT_OG_IMAGE_TYPE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Partner Program | ${PLATFORM_NAME}`,
    description: `Owltopia Partner Program — reduced fees, visibility, and tooling for established projects.`,
    images: [{ url: OG_IMAGE, alt: OG_ALT, ...DEFAULT_OG_IMAGE_DIMS }],
  },
}

const benefits: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Percent className="h-5 w-5 text-violet-400" aria-hidden />,
    title: `Reduced platform fees (${standardFeePercent}% → ${partnerFeePercent}%)`,
    body: `Verified partner creators pay a ${partnerFeePercent}% platform fee on ticket sales instead of the standard ${standardFeePercent}% non-holder rate. Fees are taken at purchase time, same as other listings.`,
  },
  {
    icon: <Ticket className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'No raffle creation fees',
    body: `Listings do not carry a separate creation or listing fee — only network costs when you deposit a prize or sign on-chain steps. The platform earns from ticket fees.`,
  },
  {
    icon: <LayoutGrid className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'Dedicated partner section',
    body: `Active partner raffles are highlighted on the main raffles page with a partner carousel and a “Partner raffles” tab so your community is easier to discover.`,
  },
  {
    icon: <BarChart3 className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'Creator dashboard',
    body: 'Use the same wallet dashboard to track your raffles, entries, revenue, and settlements after draws — including net proceeds after the platform fee.',
  },
  {
    icon: <Bot className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'Discord integration',
    body: 'We work with partners on Owltopia announcements and Discord workflows so your community stays in the loop when you run raffles with us.',
  },
  {
    icon: <Coins className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'SPL token prizes (tickets stay SOL / USDC)',
    body: 'Offer SPL token prizes such as SOL, USDC, or TRQ from escrow where supported. Ticket purchases on listings remain in SOL or USDC as configured for each raffle.',
  },
  {
    icon: <Headphones className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'Support',
    body: 'Partners get a direct line to the team for onboarding, listing questions, and incident help — reach us on Discord.',
  },
  {
    icon: <Users className="h-5 w-5 text-violet-400" aria-hidden />,
    title: 'Reach',
    body: `Host where ${PLATFORM_NAME} collectors and raffle participants already buy tickets — mobile wallets (Phantom, Solflare, and others) work with the same flows as the rest of the site.`,
  },
]

export default function PartnerProgramPage() {
  return (
    <div className="container mx-auto max-w-4xl px-3 py-8 sm:px-4">
      <Link href="/raffles">
        <Button variant="ghost" className="mb-6 min-h-[44px] touch-manipulation">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Raffles
        </Button>
      </Link>

      <div className="prose prose-invert max-w-none">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-violet-300">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              Owltopia Partner Program
            </p>
            <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Partner with Owltopia</h1>
            <p className="text-muted-foreground mb-0 max-w-2xl text-base sm:text-lg">
              We collaborate with established projects so you can host raffles on {PLATFORM_NAME} with better economics,
              visibility, and support — without changing how players connect their wallets on mobile or desktop.
            </p>
          </div>
        </div>

        <section className="mb-10 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] p-4 sm:p-6">
          <h2 className="mb-4 mt-0 text-xl font-semibold sm:text-2xl">Partner benefits</h2>
          <ul className="m-0 list-none space-y-5 p-0">
            {benefits.map((b) => (
              <li key={b.title} className="flex gap-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-background/80">
                  {b.icon}
                </span>
                <div className="min-w-0">
                  <p className="mb-1 font-semibold text-foreground">{b.title}</p>
                  <p className="mb-0 text-sm text-muted-foreground">{b.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold">See partner raffles live</h2>
          <p className="text-muted-foreground">
            The Main raffles view lists other hosts; partner program listings are only under Partner raffles (or{' '}
            <Link href="/partner-raffles" className="text-foreground underline-offset-2 hover:underline">
              this shortcut
            </Link>
            ) so your community is easy to find.
          </p>
          <div className="not-prose mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              <Link href="/raffles?tab=partner-raffles">Open partner raffles</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              <Link href="/dashboard">Creator dashboard</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-[44px] touch-manipulation w-full sm:w-auto">
              <Link href="/partners/dashboard">Partner host hub</Link>
            </Button>
          </div>
        </section>

        <section className="mb-8 rounded-lg border border-green-500/25 bg-green-500/[0.04] p-4 sm:p-6">
          <h2 className="mt-0 text-xl font-semibold sm:text-2xl">Apply or ask a question</h2>
          <p className="text-muted-foreground mb-4 text-sm sm:text-base">
            Tell us about your project and audience. We review fit, fee tier (allowlisted partner wallets), and any custom
            Discord or prize setup. No obligation — start in Discord.
          </p>
          <Button asChild className="min-h-[44px] w-full touch-manipulation sm:w-auto" size="lg">
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
              <MessageCircle className="h-5 w-5" aria-hidden />
              Message us on Discord
            </a>
          </Button>
        </section>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getRaffleBySlug, getEntriesByRaffleId } from '@/lib/db/raffles'
import { enrichRafflesWithCreatorHolder } from '@/lib/raffles/enrich-raffles-with-holder'
import { getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { RaffleReferralCapture, RaffleViewTracker } from '@/components/referrals/RaffleReferralTracking'
import { getRaffleReferralStats } from '@/lib/db/referral-stats'
import { getReferralSummaryForWallet } from '@/lib/db/referrals'
import { isReferralProgramEnabled } from '@/lib/referrals/config'
import { raffleSupportsReferralProgram } from '@/lib/referrals/program'
import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'
import { resolveRaffleShareOgImage } from '@/lib/resolve-raffle-share-og-image'
import { lookupOrbisNftUrl } from '@/lib/nft-marketplace-orbis'
import { getAdminRole } from '@/lib/db/admins'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { canViewerSeeRafflePending } from '@/lib/raffles/visibility'
import { scheduleRaffleDrawOnVisit } from '@/lib/raffles/schedule-raffle-draw-on-visit'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { canonicalRaffleSlug, raffleSlugNeedsRedirect } from '@/lib/raffles/slug-aliases'
// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SITE_URL = getSiteBaseUrl()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const raffle = await getRaffleBySlug(slug)
  if (!raffle) {
    return { title: `Raffle Not Found | ${PLATFORM_NAME}` }
  }

  const title = `${raffle.title} | ${PLATFORM_NAME}`
  const description =
    raffle.description?.replace(/\s+/g, ' ').trim().slice(0, 200) ||
    `Enter the raffle for ${raffle.title}. Trusted raffles with full transparency.`
  const publicSlug = canonicalRaffleSlug(raffle.slug)
  const canonicalUrl = `${SITE_URL}/raffles/${publicSlug}`
  const ogImage = resolveRaffleShareOgImage(raffle)

  const linkOnly = raffle.list_on_platform === false
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    ...(linkOnly
      ? { robots: { index: false, follow: true } as const }
      : {}),
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: PLATFORM_NAME,
      title,
      description,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      // Explicit image object so X shows the raffle image in the share card
      images: [{ url: ogImage.url, width: 1200, height: 630, alt: ogImage.alt }],
    },
    // Root layout sets twitter:url to the homepage. Match og:url (giveaway pages already do
    // this) so X’s crawler doesn’t see a home URL on a per-raffle card. Preserve layout `other` keys
    // in case the child’s `other` object replaces the parent’s at build time.
    other: { 'twitter:url': canonicalUrl, 'mobile-web-app-capable': 'yes' },
  }
}

export default async function RaffleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const redirectTo = raffleSlugNeedsRedirect(slug)
  if (redirectTo) {
    redirect(`/raffles/${encodeURIComponent(redirectTo)}`)
  }

  const raffle = await getRaffleBySlug(slug)
  
  if (!raffle) {
    notFound()
  }

  // If DB still has a deprecated slug, bounce to the canonical public path.
  const canonical = canonicalRaffleSlug(raffle.slug)
  if (canonical !== slug) {
    redirect(`/raffles/${encodeURIComponent(canonical)}`)
  }

  // Pending NFT raffles should only be visible to admins and the raffle creator.
  const sessionValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(sessionValue)
  const viewerWallet = session?.wallet ?? null
  const viewerIsAdmin = viewerWallet ? (await getAdminRole(viewerWallet)) !== null : false
  if (!canViewerSeeRafflePending(raffle, viewerWallet, viewerIsAdmin)) {
    notFound()
  }

  // Draw / min-threshold processing runs after the response (see scheduleRaffleDrawOnVisit).
  // Blocking selectWinner() during SSR left ended undrawn raffles stuck on "Loading raffles..." for up to ~75s (VRF).
  scheduleRaffleDrawOnVisit(raffle)

  const entries = await getEntriesByRaffleId(raffle.id)
  const milestones = await getMilestonesByRaffleId(raffle.id)
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)
  const [enrichedRaffle] = await enrichRafflesWithCreatorHolder([raffle])

  const referralProgramActive = await isReferralProgramEnabled()
  const referralEnabled = referralProgramActive && raffleSupportsReferralProgram(enrichedRaffle)
  const referralStats = referralEnabled ? await getRaffleReferralStats(raffle.id) : { promoters: [] }

  const creatorWallet = (
    enrichedRaffle.creator_wallet ||
    enrichedRaffle.created_by ||
    ''
  ).trim()
  const isCreator =
    Boolean(viewerWallet) &&
    Boolean(creatorWallet) &&
    walletsEqualSolana(viewerWallet!, creatorWallet)

  let viewerReferralCode: string | null = null
  if (viewerWallet) {
    const summary = await getReferralSummaryForWallet(viewerWallet)
    viewerReferralCode = summary?.activeCode ?? null
  }

  let orbisHref: string | null = null
  if (enrichedRaffle.prize_type === 'nft' && enrichedRaffle.nft_mint_address?.trim()) {
    const orbis = await lookupOrbisNftUrl(enrichedRaffle.nft_mint_address)
    orbisHref = orbis.found ? orbis.url : null
  }

  return (
    <>
      {referralEnabled ? (
        <Suspense fallback={null}>
          <RaffleReferralCapture slug={enrichedRaffle.slug} />
        </Suspense>
      ) : null}
      <RaffleViewTracker slug={enrichedRaffle.slug} viewerWallet={viewerWallet} />
      <RaffleDetailClient
        key={enrichedRaffle.id}
        raffle={enrichedRaffle}
        entries={entries}
        milestones={milestones}
        owlVisionScore={owlVisionScore}
        sessionWallet={viewerWallet}
        referralEnabled={referralEnabled}
        referralPromoters={referralStats.promoters}
        isCreatorViewer={isCreator}
        viewerReferralCode={viewerReferralCode}
        orbisHref={orbisHref}
      />
    </>
  )
}

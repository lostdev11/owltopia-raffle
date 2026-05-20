import { NextRequest, NextResponse } from 'next/server'
import {
  getRaffles,
  getRafflesViaRest,
  promoteDraftRafflesToLive,
} from '@/lib/db/raffles'
import { enrichRafflesWithCreatorHolder } from '@/lib/raffles/enrich-raffles-with-holder'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isNonRetryableDbErrorMessage } from '@/lib/db-retry'
import { safeErrorMessage } from '@/lib/safe-error'
import { getAdminRole } from '@/lib/db/admins'
import { filterRafflesByPendingVisibility } from '@/lib/raffles/visibility'
import { handleCreateRafflePost } from '@/lib/server/raffles/handle-create-raffle-post'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Vercel Pro serverless cap (seconds). Hobby is 10s; keep routes deployable on either tier by not relying on >10s in critical paths without testing. */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    const session = getSessionFromRequest(request)
    const viewerWallet = session?.wallet ?? null
    const viewerIsAdmin = viewerWallet ? (await getAdminRole(viewerWallet)) !== null : false

    await promoteDraftRafflesToLive()

    const { data: raffles, error } = viewerIsAdmin
      ? await getRaffles(activeOnly, activeOnly ? undefined : { includeDraft: true })
      : await getRafflesViaRest(activeOnly, {
          includeDraft: true,
          timeoutMs: 12_000,
          maxRetries: 1,
          perAttemptMs: 8_000,
        })

    if (error) {
      const isConfig = error.code === 'CONFIG'
      const isSchemaOrPostgrestBad =
        isNonRetryableDbErrorMessage(error.message) || /\bpgrst\d{3}\b|postgrest/i.test(error.message)
      const isUpstreamUnavailable =
        isConfig ||
        isSchemaOrPostgrestBad ||
        /503|service unavailable|connection|timeout|missing/i.test(error.message)
      const status = isUpstreamUnavailable ? 503 : 502
      const bodyMessage =
        status === 503
          ? isConfig
            ? 'Raffles service is not configured. Please try again later.'
            : 'Service temporarily unavailable. Please try again in a moment.'
          : safeErrorMessage(error)
      console.error('[GET /api/raffles]', error.code ?? 'error', error.message)
      return NextResponse.json(
        { error: bodyMessage, step: error.code === 'TIMEOUT' ? 'timeout' : isConfig ? 'config' : 'supabase error' },
        { status }
      )
    }

    const filtered = filterRafflesByPendingVisibility(raffles ?? [], viewerWallet, viewerIsAdmin)
    // Cart browse (`active=true`) only needs purchasability fields — skip Helius holder enrichment (timeouts).
    const skipHolderEnrich = activeOnly || searchParams.get('lite') === 'true'
    const enriched = skipHolderEnrich
      ? filtered
      : await enrichRafflesWithCreatorHolder(filtered, { budgetMs: 45_000 })
    return NextResponse.json(enriched, { status: 200 })
  } catch (err) {
    console.error('[GET /api/raffles] unexpected error:', err)
    return NextResponse.json(
      { error: safeErrorMessage(err), step: 'supabase error' },
      { status: 502 }
    )
  }
}

export async function POST(request: NextRequest) {
  return handleCreateRafflePost(request, {})
}

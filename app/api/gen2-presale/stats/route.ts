import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import { getGen2PresaleSettings } from '@/lib/db/gen2-presale-settings'
import { getOptionalUnitLamportsQuote } from '@/lib/gen2-presale/pricing'
import { getGen2PresaleStatsIssues } from '@/lib/gen2-presale/presale-sanity'
import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function isTransientNetworkFailure(err: unknown): boolean {
  const raw =
    err instanceof Error
      ? `${err.message}${err.cause instanceof Error ? ` ${err.cause.message}` : ''}`
      : String(err)
  const m = raw.toLowerCase()
  return (
    m.includes('fetch failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('econnreset') ||
    m.includes('etimedout') ||
    m.includes('enotfound') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up')
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Sold count hits Supabase multiple ways (RPC + fallback); brief outages should not blank the whole dashboard. */
async function sumConfirmedPresaleSoldWithRetries(): Promise<number> {
  const attempts = 3
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await sumConfirmedPresaleSold()
    } catch (e) {
      last = e
      if (i < attempts - 1 && isTransientNetworkFailure(e)) {
        console.warn(`[gen2-presale/stats] sold count unreachable (attempt ${i + 1}/${attempts}), retrying`)
        await sleep(350 * (i + 1))
        continue
      }
      throw e
    }
  }
  throw last
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-stats:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const offer = getGen2PresalePublicOffer()

    const settingsPromise = getGen2PresaleSettings()
    let sold = 0
    let soldSyncUnavailable = false
    try {
      sold = await sumConfirmedPresaleSoldWithRetries()
    } catch (e) {
      if (isTransientNetworkFailure(e)) {
        soldSyncUnavailable = true
        sold = 0
        console.warn('[gen2-presale/stats] Supabase unreachable — returning degraded stats (sold placeholders):', e)
      } else {
        throw e
      }
    }

    const settings = await settingsPromise
    const presale_supply = offer.presaleSupply
    const remaining = Math.max(0, presale_supply - sold)
    const percent_sold = presale_supply > 0 ? (sold / presale_supply) * 100 : 0

    const quote = await getOptionalUnitLamportsQuote()

    const payload: Gen2PresaleStats = {
      presale_supply,
      sold,
      remaining,
      percent_sold,
      unit_price_usdc: offer.priceUsdc,
      unit_lamports: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote ? quote.solUsdPrice : null,
      presale_live: settings.is_live,
      ...(soldSyncUnavailable ? { sold_sync_unavailable: true as const } : {}),
    }

    const sanityIssues = getGen2PresaleStatsIssues(payload)
    if (sanityIssues.length > 0) {
      console.warn('[gen2-presale/stats] sanity:', sanityIssues.join(' | '))
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('gen2-presale stats:', error)
    const isDev = process.env.NODE_ENV === 'development'
    const detail = isDev && error instanceof Error ? error.message : undefined
    return NextResponse.json(
      { error: 'Failed to load stats', ...(detail ? { detail } : {}) },
      { status: 500 }
    )
  }
}

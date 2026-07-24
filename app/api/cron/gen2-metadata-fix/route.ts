import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { runGen2WalletSafeMetadataFix } from '@/lib/owl-center/wallet-safe-onchain-metadata'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/gen2-metadata-fix
 *
 * Repairs Gen2 NFT metadata so wallets that don't follow arweave.net's redirect (Solflare) can render
 * the art. Sugar-deployed mints carry `image: https://arweave.net/<txid>` — a 302 → subdomain redirect
 * that Solflare's image pipeline drops, so it shows a placeholder. This drains any mint whose indexed
 * image is not yet the Owltopia proxy, re-uploading wallet-safe JSON (proxy `image` + Irys gateway
 * mirror) and `updateV1`-ing the on-chain URI. Idempotent per mint, bounded per run — serves both the
 * one-time backfill and the forward catch-all for new mints.
 *
 * Secured by CRON_SECRET (Bearer). Manual controls (admin testing): `?dry=1`, `?max=N`.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dry') === '1' || searchParams.get('dry') === 'true'
  const maxParam = parseInt(searchParams.get('max') ?? '', 10)
  const max = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(200, maxParam) : 30

  try {
    const summary = await runGen2WalletSafeMetadataFix({
      dryRun,
      max,
      timeBudgetMs: 50_000,
      concurrency: 4,
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    console.error('gen2-metadata-fix cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}

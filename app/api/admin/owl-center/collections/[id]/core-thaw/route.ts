import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  getOwlCenterLaunchByIdAdmin,
  updateOwlCenterLaunchByIdAdmin,
} from '@/lib/db/owl-center-launch'
import { thawCoreCollectionPermanentFreeze } from '@/lib/owl-center/core-cm-deploy-onchain'
import { mergeFreezeProgress } from '@/lib/owl-center/gen2-freeze-thaw'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/owl-center/collections/[id]/core-thaw
 * Thaws Metaplex Core PermanentFreezeDelegate on a public_simple Core collection (one tx).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-core-thaw:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await context.params
  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'Only public_simple launches use this thaw path' }, { status: 400 })
  }
  if (launch.mint_standard !== 'core') {
    return NextResponse.json({ error: 'Core thaw requires mint_standard=core' }, { status: 400 })
  }
  if (!launch.freeze_enabled) {
    return NextResponse.json({ error: 'Freeze was not enabled for this launch' }, { status: 400 })
  }
  const collection = launch.collection_mint?.trim()
  if (!collection) {
    return NextResponse.json({ error: 'Missing collection address — deploy first' }, { status: 400 })
  }

  const network = resolveLaunchMintNetwork(launch)
  const result = await thawCoreCollectionPermanentFreeze({
    collectionAddress: collection,
    network,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const now = new Date().toISOString()
  await updateOwlCenterLaunchByIdAdmin(launch.id, {
    freeze_status: 'thawed',
    freeze_thawed_at: now,
    freeze_progress: mergeFreezeProgress(launch.freeze_progress, {
      last_run_at: now,
      unlocked_at: now,
      last_signature: result.signature,
    }),
  })

  return NextResponse.json({ ok: true, signature: result.signature })
}

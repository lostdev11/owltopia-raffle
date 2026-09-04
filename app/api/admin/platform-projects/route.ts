import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  insertPlatformProjectManual,
  listPlatformProjectsAdmin,
} from '@/lib/db/platform-projects'
import { resolveDasCollectionHint } from '@/lib/platform-projects/resolve-das-collection'
import { sanitizeLaunchMintPubkey } from '@/lib/solana/validate-pubkey'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/platform-projects — full admin; lists the project index (CRM included).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const projects = await listPlatformProjectsAdmin()
    return NextResponse.json({ projects })
  } catch (error) {
    console.error('[admin/platform-projects GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('platform_projects') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Table missing. Run migration 218_platform_projects.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/platform-projects
 * Body: { collection_mint, display_name? }
 * Manual add by collection mint (DAS fills name/image when possible).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const mint = sanitizeLaunchMintPubkey(
      typeof body.collection_mint === 'string' ? body.collection_mint : ''
    )
    if (!mint) {
      return NextResponse.json({ error: 'collection_mint must be a valid Solana address' }, { status: 400 })
    }

    let displayName =
      typeof body.display_name === 'string' && body.display_name.trim() ? body.display_name.trim() : null
    let imageUrl: string | null = null
    const das = await resolveDasCollectionHint(mint)
    if (!displayName && das.collectionName) displayName = das.collectionName
    imageUrl = das.imageUrl

    const row = await insertPlatformProjectManual({
      collectionMint: mint,
      displayName,
      imageUrl,
    })
    return NextResponse.json({ project: row })
  } catch (error) {
    console.error('[admin/platform-projects POST]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

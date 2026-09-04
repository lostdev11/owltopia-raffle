import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { prepareCoinArtUpgradeZipDirectUpload } from '@/lib/coin-upgrade/art-upload-stage'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/coin-upgrade/art/stage/prepare
 * Body: { filename, byte_size } → signed Supabase upload URL for the ZIP.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => null)
    const filename = typeof body?.filename === 'string' ? body.filename : 'coin-upgrade.zip'
    const byteSize = Number(body?.byte_size)
    if (!Number.isFinite(byteSize) || byteSize < 1) {
      return NextResponse.json({ ok: false, error: 'byte_size is required.' }, { status: 400 })
    }
    const result = await prepareCoinArtUpgradeZipDirectUpload({
      originalFilename: filename,
      byteSize,
    })
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/coin-upgrade/art/stage/prepare]', e)
    return NextResponse.json({ ok: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { completeCoinArtUpgradeZipDirectUpload } from '@/lib/coin-upgrade/art-upload-stage'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/admin/coin-upgrade/art/stage/complete
 * Body: { job_id, path, filename, byte_size } after the browser PUT to signed URL.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => null)
    const jobId = typeof body?.job_id === 'string' ? body.job_id.trim() : ''
    const path = typeof body?.path === 'string' ? body.path.trim() : ''
    const filename = typeof body?.filename === 'string' ? body.filename : 'coin-upgrade.zip'
    const byteSize = Number(body?.byte_size)
    if (!jobId || !path || !Number.isFinite(byteSize)) {
      return NextResponse.json({ ok: false, error: 'job_id, path, and byte_size are required.' }, { status: 400 })
    }
    const result = await completeCoinArtUpgradeZipDirectUpload({
      jobId,
      path,
      originalFilename: filename,
      byteSize,
      createdBy: session.wallet,
    })
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/coin-upgrade/art/stage/complete]', e)
    return NextResponse.json({ ok: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Constant-time Bearer comparison for cron routes (`Authorization: Bearer ${CRON_SECRET}`).
 * Returns a 401/500 NextResponse when unauthorized / misconfigured, otherwise null.
 */
export function authorizeCronBearer(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  const expected = `Bearer ${secret}`
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  return null
}

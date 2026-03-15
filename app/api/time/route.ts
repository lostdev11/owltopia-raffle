/**
 * Returns server time (UTC) so the client can use a single source of truth
 * for raffle bucketing and relative time strings, avoiding wrong PC clock issues.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return Response.json({ now: new Date().toISOString() })
}

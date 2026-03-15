#!/usr/bin/env node
/**
 * Quick check that GET /api/config/prize-escrow returns 200 + address when
 * PRIZE_ESCROW_SECRET_KEY is set, or 503 when not configured.
 *
 * Usage: run with dev server up.
 *   node scripts/check-prize-escrow-api.mjs
 *
 * Optional env:
 *   BASE_URL  base URL of the app (default: http://localhost:3000)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const url = `${BASE_URL.replace(/\/$/, '')}/api/config/prize-escrow`

async function main() {
  console.log('Checking GET', url)
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('Request failed:', err.message)
    console.error('Is the dev server running? (e.g. npm run dev)')
    process.exit(1)
  }

  const body = await res.json().catch(() => ({}))
  if (res.status === 200 && body.address) {
    console.log('OK – Prize escrow is configured')
    console.log('Address:', body.address)
    process.exit(0)
  }
  if (res.status === 503 && body.error) {
    console.log('OK – Prize escrow is not configured (expected 503)')
    console.log('Message:', body.error)
    process.exit(0)
  }
  console.error('Unexpected response:', res.status, body)
  process.exit(1)
}

main()

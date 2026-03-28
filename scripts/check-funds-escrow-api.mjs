/**
 * GET /api/config/funds-escrow — 200 + address when FUNDS_ESCROW_SECRET_KEY is set, else 503.
 *   node scripts/check-funds-escrow-api.mjs
 *   BASE_URL=https://yoursite.com npm run check:funds-escrow
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const url = `${BASE_URL.replace(/\/$/, '')}/api/config/funds-escrow`

fetch(url)
  .then(async (r) => {
    const text = await r.text()
    console.log(r.status, text.slice(0, 300))
    if (r.ok) console.log('\nOK – Funds escrow is configured')
    else console.log('\n503 or error – set FUNDS_ESCROW_SECRET_KEY in .env.local and restart dev server')
  })
  .catch((e) => console.error(e))

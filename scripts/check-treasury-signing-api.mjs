/**
 * GET /api/config/treasury-signing — 200 when RAFFLE_RECIPIENT_SECRET_KEY is set on the running deployment.
 *
 *   npm run check:treasury-signing-api
 *   BASE_URL=https://www.owltopia.xyz npm run check:treasury-signing-api
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const url = `${BASE_URL.replace(/\/$/, '')}/api/config/treasury-signing`

fetch(url)
  .then(async (r) => {
    const text = await r.text()
    console.log(r.status, text.slice(0, 400))
    if (r.ok) console.log('\nOK – Treasury signing is enabled on this deployment')
    else {
      console.log(
        '\n503 or error – set RAFFLE_RECIPIENT_SECRET_KEY on this environment (Vercel Production) and redeploy',
      )
    }
  })
  .catch((e) => console.error(e))

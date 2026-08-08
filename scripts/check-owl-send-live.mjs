#!/usr/bin/env node
/**
 * Confirm OwlSend is public on the live site (RSC payload isPublic:true).
 *
 * Usage:
 *   npm run check:owl-send-live
 *   BASE_URL=https://www.owltopia.xyz node scripts/check-owl-send-live.mjs
 */

const BASE_URL = (process.env.BASE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')

async function main() {
  console.log(`Checking OwlSend public gate at ${BASE_URL}/owl-send\n`)
  const res = await fetch(`${BASE_URL}/owl-send`, {
    headers: { Accept: 'text/html' },
    redirect: 'follow',
  })
  const html = await res.text()
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}`)
    process.exit(1)
  }

  // RSC flight may embed props as `"isPublic":false` or escaped `\"isPublic\":false`.
  const publicTrue = /\\?"isPublic\\?"\s*:\s*true/.test(html)
  const publicFalse = /\\?"isPublic\\?"\s*:\s*false/.test(html)

  if (publicTrue) {
    console.log('✓ OwlSend is public (isPublic:true in RSC payload)')
    console.log('  Nav should show OwlSend; /owl-send is open to connected wallets.')
    process.exit(0)
  }

  if (publicFalse) {
    console.error('✗ OwlSend is still admin-only (isPublic:false)')
    console.error('  Set on Vercel Production (+ Preview):')
    console.error('    OWL_SEND_PUBLIC=true')
    console.error('    NEXT_PUBLIC_OWL_SEND_PUBLIC=true')
    console.error('  Then Redeploy Production and re-run this check.')
    console.error('  Or: npm run vercel:owl-send:go-live')
    process.exit(1)
  }

  console.error('✗ Could not find isPublic in /owl-send HTML — page shape may have changed.')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

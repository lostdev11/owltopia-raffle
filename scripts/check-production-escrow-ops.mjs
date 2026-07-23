#!/usr/bin/env node
/**
 * Smoke-check production escrow + Solana RPC ops without Vercel dashboard access.
 * Probes live endpoints on owltopia.xyz (or BASE_URL) to confirm server env is wired.
 *
 * Usage:
 *   npm run check:production-escrow-ops
 *   BASE_URL=https://www.owltopia.xyz node scripts/check-production-escrow-ops.mjs
 */

const BASE_URL = (process.env.BASE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')

async function fetchJson(path, init) {
  const res = await fetch(`${BASE_URL}${path}`, init)
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

async function rpc(method) {
  const { res, body } = await fetchJson('/api/solana/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  })
  return { res, body }
}

async function main() {
  console.log(`Checking production ops at ${BASE_URL}\n`)
  let failed = false

  const escrow = await fetchJson('/api/config/prize-escrow')
  if (escrow.res.status === 200 && typeof escrow.body.address === 'string' && escrow.body.address.trim()) {
    console.log('✓ Prize escrow configured (PRIZE_ESCROW_SECRET_KEY on server)')
    console.log(`  address: ${escrow.body.address}`)
  } else {
    console.error('✗ Prize escrow not configured:', escrow.res.status, escrow.body)
    failed = true
  }

  const health = await rpc('getHealth')
  if (health.res.status === 200 && health.body?.result === 'ok') {
    console.log('✓ Server Solana RPC reachable (SOLANA_RPC_URL / NEXT_PUBLIC_SOLANA_RPC_URL)')
  } else if (health.res.status === 503) {
    console.error('✗ Solana RPC not configured on server (would use public mainnet fallback)')
    failed = true
  } else {
    console.error('✗ Unexpected RPC health response:', health.res.status, health.body)
    failed = true
  }

  const version = await rpc('getVersion')
  if (version.res.status === 200 && version.body?.result) {
    const core = version.body.result['solana-core'] ?? version.body.result
    console.log(`✓ RPC getVersion ok (solana-core: ${core})`)
  } else {
    console.error('✗ RPC getVersion failed:', version.res.status, version.body)
    failed = true
  }

  const cron = await fetch(`${BASE_URL}/api/cron/verify-pending-escrow-deposits`)
  if (cron.status === 401) {
    console.log('✓ Escrow verify cron requires auth (CRON_SECRET is set)')
  } else if (cron.status === 500) {
    console.error('✗ Escrow verify cron returned 500 — CRON_SECRET may be missing')
    failed = true
  } else {
    console.log(`? Escrow verify cron status ${cron.status} (expected 401 without Bearer token)`)
  }

  console.log('\nNote: This does not read Vercel env vars directly. It confirms production behavior.')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

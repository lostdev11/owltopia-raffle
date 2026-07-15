import { NextRequest, NextResponse } from 'next/server'

import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Per-IP budget for browser mint prep (CM/guard fetch, blockhash, send, confirm). */
const RATE_LIMIT = 180
const RATE_WINDOW_MS = 60_000
const UPSTREAM_TIMEOUT_MS = 25_000

/**
 * Methods used by Owl Center / Gen2 browser mint and purchase flows
 * (Umi + web3.js Connection over the same-origin proxy).
 */
const ALLOWED_RPC_METHODS = new Set([
  'getAccountInfo',
  'getMultipleAccounts',
  'getBalance',
  'getLatestBlockhash',
  'getBlockHeight',
  'getBlockTime',
  'getEpochInfo',
  'getFeeForMessage',
  'getMinimumBalanceForRentExemption',
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSignatureStatus',
  'getSignaturesForAddress',
  'getSlot',
  'getTransaction',
  'getTransactionCount',
  'getVersion',
  'getHealth',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
  'getAddressLookupTable',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
])

function extractRpcMethods(body: unknown): string[] | null {
  if (Array.isArray(body)) {
    const methods: string[] = []
    for (const item of body) {
      if (!item || typeof item !== 'object' || typeof (item as { method?: unknown }).method !== 'string') {
        return null
      }
      methods.push((item as { method: string }).method)
    }
    return methods
  }
  if (body && typeof body === 'object' && typeof (body as { method?: unknown }).method === 'string') {
    return [(body as { method: string }).method]
  }
  return null
}

/**
 * Same-origin Solana JSON-RPC proxy for Owl Center mints.
 * Mobile wallets often time out on direct calls to third-party RPC hosts; routing through
 * the app uses the server `SOLANA_RPC_URL` (Helius) on a stable connection.
 * Only mint/purchase-related methods are forwarded.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`solana-rpc-proxy:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32005, message: 'Rate limit exceeded — wait a moment and retry.' }, id: null },
      { status: 429 }
    )
  }

  const upstream = resolveServerSolanaRpcUrl()
  const hasPaidRpc =
    Boolean(process.env.SOLANA_RPC_URL?.trim()) || Boolean(process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim())
  if (!upstream || (!hasPaidRpc && upstream.includes('api.mainnet-beta.solana.com'))) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Solana RPC not configured on server.' }, id: null },
      { status: 503 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
      { status: 400 }
    )
  }

  const methods = extractRpcMethods(body)
  if (!methods || methods.length === 0) {
    return NextResponse.json(
      { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null },
      { status: 400 }
    )
  }
  for (const method of methods) {
    if (!ALLOWED_RPC_METHODS.has(method)) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not allowed: ${method}` },
          id: Array.isArray(body) ? null : ((body as { id?: unknown })?.id ?? null),
        },
        { status: 400 }
      )
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const timedOut = /abort|timeout/i.test(msg)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: timedOut ? -32002 : -32000,
          message: timedOut ? 'Upstream RPC timed out' : 'Upstream RPC unreachable',
        },
        id: (body as { id?: unknown })?.id ?? null,
      },
      { status: timedOut ? 504 : 502 }
    )
  } finally {
    clearTimeout(timer)
  }
}

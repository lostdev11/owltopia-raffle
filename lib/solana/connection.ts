/**
 * Server-side Solana RPC connection helpers.
 *
 * - **Primary** ({@link getSolanaConnection}): sends, confirms, `getTransaction`, and anything that needs
 *   your paid RPC / Helius archival or DAS-capable traffic.
 * - **Read** ({@link getSolanaReadConnection}): optional `SOLANA_RPC_READ_URL` for account scans, SPL
 *   balance checks, and nesting verification; when unset, equals primary.
 */
import { Connection } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl, resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'

const PUBLIC_MAINNET_RPC_HOST = 'api.mainnet-beta.solana.com'
let warnedPublicRpcInProduction = false

/** Logs once when production server RPC still points at the public Solana endpoint. */
function warnIfUsingPublicRpcInProduction(): void {
  if (warnedPublicRpcInProduction) return
  if (process.env.NODE_ENV !== 'production') return
  const url = resolveServerSolanaRpcUrl().toLowerCase()
  if (!url.includes(PUBLIC_MAINNET_RPC_HOST)) return
  warnedPublicRpcInProduction = true
  console.warn(
    '[solana] SOLANA_RPC_URL is unset or points at the public mainnet RPC. ' +
      'Set SOLANA_RPC_URL and NEXT_PUBLIC_SOLANA_RPC_URL to a paid provider (e.g. Helius) ' +
      'so escrow verify does not hit rate limits.'
  )
}

export function getSolanaConnection(): Connection {
  warnIfUsingPublicRpcInProduction()
  return new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
}

export function getSolanaReadConnection(): Connection {
  return new Connection(resolveServerSolanaReadRpcUrl(), 'confirmed')
}

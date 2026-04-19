/**
 * Server-side Solana RPC connection helpers.
 *
 * - **Primary** ({@link getSolanaConnection}): sends, confirms, `getTransaction`, and anything that needs
 *   your paid RPC / Helius archival or DAS-capable traffic.
 * - **Read** ({@link getSolanaReadConnection}): optional `SOLANA_RPC_READ_URL` for account scans and SPL
 *   balance checks to spare paid credits when unset equals primary.
 */
import { Connection } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl, resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'

export function getSolanaConnection(): Connection {
  return new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
}

export function getSolanaReadConnection(): Connection {
  return new Connection(resolveServerSolanaReadRpcUrl(), 'confirmed')
}

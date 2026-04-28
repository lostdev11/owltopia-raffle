/**
 * Server-side Solana RPC connection helpers.
 * Primary: sends, confirmations, escrow. Read: optional `SOLANA_RPC_READ_URL` for nesting verification, etc.
 */
import { Connection } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl, resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'

export function getSolanaConnection(): Connection {
  return new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
}

export function getSolanaReadConnection(): Connection {
  return new Connection(resolveServerSolanaReadRpcUrl(), 'confirmed')
}

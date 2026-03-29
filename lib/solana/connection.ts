/**
 * Server-side Solana RPC connection helper.
 * Used by prize escrow transfer and verification.
 */
import { Connection } from '@solana/web3.js'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export function getSolanaConnection(): Connection {
  return new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
}

/**
 * Server-side Solana RPC connection helper.
 * Used by prize escrow transfer and verification.
 */
import { Connection } from '@solana/web3.js'

function getRpcUrl(): string {
  let rpcUrl =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    'https://api.mainnet-beta.solana.com'

  if (rpcUrl && !rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
    if (!rpcUrl.includes('://')) rpcUrl = `https://${rpcUrl}`
    else rpcUrl = 'https://api.mainnet-beta.solana.com'
  }
  if (!rpcUrl || (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://'))) {
    return 'https://api.mainnet-beta.solana.com'
  }
  return rpcUrl
}

export function getSolanaConnection(): Connection {
  return new Connection(getRpcUrl(), 'confirmed')
}

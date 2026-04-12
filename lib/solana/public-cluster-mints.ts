import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
/** Circle devnet USDC (common faucet mint). */
const USDC_MINT_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgTJJDnY'

/**
 * USDC mint for the RPC URL the browser wallet uses (mainnet vs devnet).
 */
export function getPublicUsdcMintAddress(): string {
  return /devnet/i.test(resolvePublicSolanaRpcUrl()) ? USDC_MINT_DEVNET : USDC_MINT_MAINNET
}

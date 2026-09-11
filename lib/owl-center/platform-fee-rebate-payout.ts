/**
 * Server payout key for releasing locked platform mint-fee rebates to partners.
 *
 * Env:
 *   OWL_PLATFORM_FEE_REBATE_PAYOUT_SECRET_KEY — base58 or JSON-array secret (treasury or funded hot wallet)
 *   OWL_PLATFORM_FEE_REBATE_PAYOUT_WALLET — optional explicit address (must match keypair)
 */
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

export function parseOwlCenterPlatformFeeRebatePayoutSecret(): Uint8Array | null {
  const raw = process.env.OWL_PLATFORM_FEE_REBATE_PAYOUT_SECRET_KEY?.trim()
  if (!raw) return null
  try {
    return bs58.decode(raw)
  } catch {
    try {
      const parsed = JSON.parse(raw) as number[]
      if (Array.isArray(parsed) && parsed.length >= 64) return Uint8Array.from(parsed)
    } catch {
      // not JSON
    }
  }
  return null
}

export function loadOwlCenterPlatformFeeRebatePayoutKeypair(): Keypair | null {
  const secret = parseOwlCenterPlatformFeeRebatePayoutSecret()
  if (!secret) return null
  try {
    return Keypair.fromSecretKey(secret)
  } catch {
    return null
  }
}

export function getOwlCenterPlatformFeeRebatePayoutWalletAddress(): string | null {
  const explicit = process.env.OWL_PLATFORM_FEE_REBATE_PAYOUT_WALLET?.trim()
  if (explicit) return explicit
  return loadOwlCenterPlatformFeeRebatePayoutKeypair()?.publicKey.toBase58() ?? null
}

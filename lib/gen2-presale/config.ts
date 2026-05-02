/**
 * Gen2 presale configuration (server + shared constants).
 * Env vars: see `.env.example` section “Owltopia Gen2 presale”.
 */
import { PublicKey } from '@solana/web3.js'

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'

export type Gen2PresaleEnvConfig = {
  priceUsdc: number
  presaleSupply: number
  solUsdPrice: number
  founderA: PublicKey
  founderB: PublicKey
  founderAPercent: number
  founderBPercent: number
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function parsePositiveUsdc(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function parsePercent(raw: string | undefined, fallback: number): number {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return fallback
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback
  return Math.round(n)
}

export type Gen2PresaleServerConfigOptions = {
  /** Use the SOL/USD rate from create-transaction so confirm matches on-chain amounts after refreshes. */
  solUsdPrice?: number
}

function parseGen2PresaleEnvBase(): Omit<Gen2PresaleEnvConfig, 'solUsdPrice'> {
  const priceUsdc = parsePositiveUsdc(
    process.env.NEXT_PUBLIC_GEN2_PRESALE_PRICE_USDC ?? process.env.GEN2_PRESALE_PRICE_USDC,
    20
  )
  const presaleSupply = parsePositiveInt(
    process.env.NEXT_PUBLIC_GEN2_PRESALE_SUPPLY ?? process.env.GEN2_PRESALE_SUPPLY,
    657
  )

  const aRaw = process.env.FOUNDER_A_WALLET?.trim()
  const bRaw = process.env.FOUNDER_B_WALLET?.trim()
  if (!aRaw || !bRaw) {
    throw new Error('FOUNDER_A_WALLET and FOUNDER_B_WALLET must be set (base58 Solana addresses).')
  }
  let founderA: PublicKey
  let founderB: PublicKey
  try {
    founderA = new PublicKey(aRaw)
    founderB = new PublicKey(bRaw)
  } catch {
    throw new Error('FOUNDER_A_WALLET or FOUNDER_B_WALLET is not a valid Solana address.')
  }
  if (founderA.equals(founderB)) {
    throw new Error('FOUNDER_A_WALLET and FOUNDER_B_WALLET must be different.')
  }

  const founderAPercent = parsePercent(process.env.FOUNDER_A_PERCENT, 50)
  const founderBPercent = parsePercent(process.env.FOUNDER_B_PERCENT, 50)
  if (founderAPercent + founderBPercent !== 100) {
    throw new Error('FOUNDER_A_PERCENT and FOUNDER_B_PERCENT must sum to 100.')
  }

  return {
    priceUsdc,
    presaleSupply,
    founderA,
    founderB,
    founderAPercent,
    founderBPercent,
  }
}

/**
 * Server presale config. SOL/USD from Jupiter (cached) unless overridden (e.g. confirm passes rate from create).
 */
export async function getGen2PresaleServerConfig(
  options?: Gen2PresaleServerConfigOptions
): Promise<Gen2PresaleEnvConfig> {
  const base = parseGen2PresaleEnvBase()
  const override = options?.solUsdPrice
  const solUsdPrice =
    override != null && Number.isFinite(override) && override > 0 ? override : await resolveGen2SolUsdPrice()
  return { ...base, solUsdPrice }
}

/** Supply / USDC price for public stats (no founder wallets required). */
export function getGen2PresalePublicOffer(): { priceUsdc: number; presaleSupply: number } {
  const priceUsdc = parsePositiveUsdc(
    process.env.NEXT_PUBLIC_GEN2_PRESALE_PRICE_USDC ?? process.env.GEN2_PRESALE_PRICE_USDC,
    20
  )
  const presaleSupply = parsePositiveInt(
    process.env.NEXT_PUBLIC_GEN2_PRESALE_SUPPLY ?? process.env.GEN2_PRESALE_SUPPLY,
    657
  )
  return { priceUsdc, presaleSupply }
}

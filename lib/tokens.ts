/**
 * Token metadata and feature flags for raffle currencies (SOL, USDC, OWL).
 * OWL is an SPL token; mint address is configured via env when available.
 */

import type { RaffleCurrency } from '@/lib/types'

const SOL_MINT = 'So11111111111111111111111111111111111111112'
const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export interface TokenInfo {
  symbol: string
  decimals: number
  mintAddress: string | null
}

const SOL_INFO: TokenInfo = {
  symbol: 'SOL',
  decimals: 9,
  mintAddress: SOL_MINT,
}

const USDC_INFO: TokenInfo = {
  symbol: 'USDC',
  decimals: 6,
  mintAddress: USDC_MINT_MAINNET,
}

/**
 * OWL mint address from env. When set, OWL checkout is enabled.
 */
function getOwlMintAddress(): string | null {
  const raw = process.env.NEXT_PUBLIC_OWL_MINT_ADDRESS
  return raw?.trim() || null
}

/**
 * OWL decimals from env (optional). If set, must be 0–9.
 */
function getOwlDecimalsFromEnv(): number | null {
  const raw = process.env.OWL_DECIMALS ?? process.env.NEXT_PUBLIC_OWL_DECIMALS
  if (raw === undefined || raw === null || raw === '') return null
  const n = parseInt(String(raw), 10)
  if (Number.isNaN(n) || n < 0 || n > 9) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[tokens] OWL_DECIMALS must be 0–9; got:', raw)
    }
    return null
  }
  return n
}

/**
 * Returns true only when NEXT_PUBLIC_OWL_MINT_ADDRESS is set.
 * Used to gate OWL checkout and to show OWL in admin currency options.
 */
export function isOwlEnabled(): boolean {
  return !!getOwlMintAddress()
}

/**
 * Token metadata for SOL, USDC, and OWL.
 * OWL mint/decimals come from env when OWL is enabled.
 */
export function getTokenInfo(currency: RaffleCurrency): TokenInfo {
  switch (currency) {
    case 'SOL':
      return SOL_INFO
    case 'USDC':
      return USDC_INFO
    case 'OWL': {
      const mint = getOwlMintAddress()
      const decimals = getOwlDecimalsFromEnv() ?? 6
      return {
        symbol: 'OWL',
        decimals,
        mintAddress: mint,
      }
    }
    default:
      return SOL_INFO
  }
}

/**
 * All supported currency codes (for validation).
 */
export const RAFFLE_CURRENCIES: RaffleCurrency[] = ['SOL', 'USDC', 'OWL']

export function isRaffleCurrency(s: string): s is RaffleCurrency {
  return RAFFLE_CURRENCIES.includes(s as RaffleCurrency)
}

export type { RaffleCurrency }

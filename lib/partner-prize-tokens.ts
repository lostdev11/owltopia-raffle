/**
 * Allowlisted partner tokens usable as raffle prizes (tickets stay SOL/USDC/OWL).
 * Mint addresses are mainnet; devnet would use different mints and is not supported here.
 */

import type { Raffle } from '@/lib/types'

/** Mainnet TRQ (Token-2022). */
export const TRQ_MINT_MAINNET = 'TRQK2buch9Ht11wfxLDE4FmfCKbSz6rME1vTDbmNGLX'

/** Wrapped SOL — prize is deposited as an SPL transfer of wSOL to escrow. */
export const WSOL_MINT_MAINNET = 'So11111111111111111111111111111111111111112'

export const USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export type PartnerPrizeTokenProgram = 'token2022' | 'spl'

export interface PartnerPrizeTokenDefinition {
  /** Stored in `raffles.prize_currency` (uppercase). */
  currencyCode: string
  mint: string
  tokenProgram: PartnerPrizeTokenProgram
  /** Decimals on mainnet (override if env wrong). */
  decimals: number
  /**
   * Listing / OG image. Prefer HTTPS under our public dir for zero config;
   * override with NEXT_PUBLIC_TRQ_PRIZE_IMAGE_URL when you have a CDN URL.
   */
  defaultImagePath: string
}

const TRQ_DEFINITION: PartnerPrizeTokenDefinition = {
  currencyCode: 'TRQ',
  mint: TRQ_MINT_MAINNET,
  tokenProgram: 'token2022',
  decimals: 9,
  defaultImagePath: '/trq-prize.svg',
}

const USDC_DEFINITION: PartnerPrizeTokenDefinition = {
  currencyCode: 'USDC',
  mint: USDC_MINT_MAINNET,
  tokenProgram: 'spl',
  decimals: 6,
  defaultImagePath: '/usdc.png',
}

const SOL_DEFINITION: PartnerPrizeTokenDefinition = {
  currencyCode: 'SOL',
  mint: WSOL_MINT_MAINNET,
  tokenProgram: 'spl',
  decimals: 9,
  defaultImagePath: '/icon.png',
}

const PARTNERS: PartnerPrizeTokenDefinition[] = [TRQ_DEFINITION, USDC_DEFINITION, SOL_DEFINITION]

/**
 * When true, the create-raffle token dropdown enables selecting OWL (still requires an OWL row in PARTNERS).
 * Keep false until OWL prize mint and ops are wired.
 */
export const PARTNER_OWL_PRIZE_UI_ENABLED = false

export function listPartnerPrizeTokens(): readonly PartnerPrizeTokenDefinition[] {
  return PARTNERS
}

export function getPartnerPrizeTokenByCurrency(currency: string | null | undefined): PartnerPrizeTokenDefinition | null {
  const c = (currency || '').trim().toUpperCase()
  if (!c) return null
  return PARTNERS.find((p) => p.currencyCode === c) ?? null
}

export function isPartnerPrizeCurrency(currency: string | null | undefined): boolean {
  return getPartnerPrizeTokenByCurrency(currency) != null
}

/** Crypto raffle whose prize is a partner SPL (not legacy SOL/USDC on-chain prize). */
export function isPartnerSplPrizeRaffle(
  raffle: Pick<Raffle, 'prize_type' | 'prize_currency'> | { prize_type?: string | null; prize_currency?: string | null }
): boolean {
  return (raffle.prize_type || '').toLowerCase() === 'crypto' && isPartnerPrizeCurrency(raffle.prize_currency)
}

export function getPartnerPrizeListingImageUrl(currency?: string | null): string {
  const c = (currency || 'TRQ').trim().toUpperCase()
  if (c === 'TRQ') {
    const fromEnv = process.env.NEXT_PUBLIC_TRQ_PRIZE_IMAGE_URL?.trim()
    if (fromEnv) return fromEnv
    return TRQ_DEFINITION.defaultImagePath
  }
  const def = getPartnerPrizeTokenByCurrency(c)
  return def?.defaultImagePath ?? TRQ_DEFINITION.defaultImagePath
}

export function getPartnerPrizeMintForCurrency(currency: string | null | undefined): string | null {
  return getPartnerPrizeTokenByCurrency(currency)?.mint ?? null
}

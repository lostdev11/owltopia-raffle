import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { SystemProgram } from '@solana/web3.js'

import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function isParsed(ix: {
  parsed?: unknown
}): ix is {
  parsed: {
    type?: string
    info?: { source?: string; destination?: string; lamports?: number | string }
  }
} {
  return 'parsed' in ix && ix.parsed !== undefined
}

function lamportsFromInfo(info?: { lamports?: number | string }): bigint {
  const L = info?.lamports
  if (typeof L === 'bigint') return L
  if (typeof L === 'number' && Number.isFinite(L)) return BigInt(Math.floor(L))
  if (typeof L === 'string' && L.trim()) return BigInt(L.trim())
  return 0n
}

function sumTransferFromBuyerToDest(
  parsed: ParsedTransactionWithMeta,
  buyerNorm: string,
  destNorm: string
): bigint {
  let total = 0n
  const visit = (ix: { programId?: { equals: (k: unknown) => boolean }; parsed?: unknown }) => {
    if (!ix.programId?.equals(SystemProgram.programId)) return
    if (!isParsed(ix)) return
    if (ix.parsed.type !== 'transfer') return
    const src = normalizeSolanaWalletAddress(ix.parsed.info?.source ?? '')
    const dest = normalizeSolanaWalletAddress(ix.parsed.info?.destination ?? '')
    if (src !== buyerNorm || dest !== destNorm) return
    total += lamportsFromInfo(ix.parsed.info)
  }

  const msg = parsed.transaction.message
  for (const ix of msg.instructions as {
    programId?: { equals: (k: unknown) => boolean }
    parsed?: unknown
  }[]) {
    visit(ix)
  }
  for (const group of parsed.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as {
      programId?: { equals: (k: unknown) => boolean }
      parsed?: unknown
    }[]) {
      visit(ix)
    }
  }
  return total
}

/** Exported for confirm drift checks against the live oracle expected lamports. */
export function sumOwlCenterTreasuryTransferFromBuyer(
  parsed: ParsedTransactionWithMeta,
  buyerNorm: string,
  treasuryNorm: string
): bigint {
  return sumTransferFromBuyerToDest(parsed, buyerNorm, treasuryNorm)
}

export function verifyOwlCenterTreasuryPayment(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  treasuryWallet: string
  expectLamports: bigint
}): boolean {
  if (params.parsed.meta?.err) return false
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  const treasuryNorm = normalizeSolanaWalletAddress(params.treasuryWallet)
  if (!buyerNorm || !treasuryNorm) return false
  const got = sumTransferFromBuyerToDest(params.parsed, buyerNorm, treasuryNorm)
  return got === params.expectLamports
}

/** Verify partner proceeds + platform fee (same destination allowed — combined amount). */
export function verifyOwlCenterPresaleSplitPayment(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  partnerWallet: string
  platformFeeWallet: string
  expectPartnerLamports: bigint
  expectPlatformFeeLamports: bigint
}): boolean {
  if (params.parsed.meta?.err) return false
  const buyerNorm = normalizeSolanaWalletAddress(params.buyerWallet)
  const partnerNorm = normalizeSolanaWalletAddress(params.partnerWallet)
  const feeNorm = normalizeSolanaWalletAddress(params.platformFeeWallet)
  if (!buyerNorm || !partnerNorm || !feeNorm) return false

  if (partnerNorm === feeNorm) {
    const got = sumTransferFromBuyerToDest(params.parsed, buyerNorm, partnerNorm)
    return got === params.expectPartnerLamports + params.expectPlatformFeeLamports
  }

  const gotPartner = sumTransferFromBuyerToDest(params.parsed, buyerNorm, partnerNorm)
  const gotFee = sumTransferFromBuyerToDest(params.parsed, buyerNorm, feeNorm)
  return gotPartner === params.expectPartnerLamports && gotFee === params.expectPlatformFeeLamports
}

export function sumOwlCenterPresaleSplitFromBuyer(
  parsed: ParsedTransactionWithMeta,
  buyerNorm: string,
  partnerNorm: string,
  feeNorm: string
): { partner: bigint; platformFee: bigint; total: bigint } {
  if (partnerNorm === feeNorm) {
    const total = sumTransferFromBuyerToDest(parsed, buyerNorm, partnerNorm)
    return { partner: total, platformFee: 0n, total }
  }
  const partner = sumTransferFromBuyerToDest(parsed, buyerNorm, partnerNorm)
  const platformFee = sumTransferFromBuyerToDest(parsed, buyerNorm, feeNorm)
  return { partner, platformFee, total: partner + platformFee }
}

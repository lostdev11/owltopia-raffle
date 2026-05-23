import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { SystemProgram } from '@solana/web3.js'

import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function isParsed(ix: { parsed?: unknown }): ix is { parsed: { type?: string; info?: { source?: string; destination?: string; lamports?: number | string } } } {
  return 'parsed' in ix && ix.parsed !== undefined
}

function lamportsFromInfo(info?: { lamports?: number | string }): bigint {
  const L = info?.lamports
  if (typeof L === 'bigint') return L
  if (typeof L === 'number' && Number.isFinite(L)) return BigInt(Math.floor(L))
  if (typeof L === 'string' && L.trim()) return BigInt(L.trim())
  return 0n
}

function sumTreasuryTransferFromBuyer(
  parsed: ParsedTransactionWithMeta,
  buyerNorm: string,
  treasuryNorm: string
): bigint {
  let total = 0n
  const visit = (ix: { programId?: { equals: (k: unknown) => boolean }; parsed?: unknown }) => {
    if (!ix.programId?.equals(SystemProgram.programId)) return
    if (!isParsed(ix)) return
    if (ix.parsed.type !== 'transfer') return
    const src = normalizeSolanaWalletAddress(ix.parsed.info?.source ?? '')
    const dest = normalizeSolanaWalletAddress(ix.parsed.info?.destination ?? '')
    if (src !== buyerNorm || dest !== treasuryNorm) return
    total += lamportsFromInfo(ix.parsed.info)
  }

  const msg = parsed.transaction.message
  for (const ix of msg.instructions as { programId?: { equals: (k: unknown) => boolean }; parsed?: unknown }[]) {
    visit(ix)
  }
  for (const group of parsed.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as { programId?: { equals: (k: unknown) => boolean }; parsed?: unknown }[]) {
      visit(ix)
    }
  }
  return total
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
  const got = sumTreasuryTransferFromBuyer(params.parsed, buyerNorm, treasuryNorm)
  return got === params.expectLamports
}

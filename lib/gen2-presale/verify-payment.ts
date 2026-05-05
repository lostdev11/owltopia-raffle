import {
  Connection,
  LAMPORTS_PER_SOL,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'

import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return 'parsed' in ix && ix.parsed !== undefined
}

function lamportsFromParsedTransfer(parsed: { info?: { lamports?: number | string } }): bigint {
  const L = parsed?.info?.lamports
  if (typeof L === 'bigint') return L
  if (typeof L === 'number' && Number.isFinite(L)) return BigInt(Math.floor(L))
  if (typeof L === 'string' && L.trim()) return BigInt(L.trim())
  return 0n
}

function collectTransfersFromBuyer(
  parsed: ParsedTransactionWithMeta,
  buyerNorm: string
): Map<string, bigint> {
  const toFounder = new Map<string, bigint>()
  const push = (dest: string | undefined, src: string | undefined, lamports: bigint) => {
    if (!dest || !src) return
    const s = normalizeSolanaWalletAddress(src)
    const d = normalizeSolanaWalletAddress(dest)
    if (!s || !d || s !== buyerNorm) return
    toFounder.set(d, (toFounder.get(d) ?? 0n) + lamports)
  }

  const visitIx = (ix: ParsedInstruction | PartiallyDecodedInstruction) => {
    if (!isParsed(ix)) return
    if (!ix.programId.equals(SystemProgram.programId)) return
    const p = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
    if (p.type !== 'transfer') return
    const lamports = lamportsFromParsedTransfer({ info: p.info })
    push(p.info?.destination, p.info?.source, lamports)
  }

  const msg = parsed.transaction.message
  const instructions = msg.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]
  for (const ix of instructions) {
    visitIx(ix)
  }

  const inner = parsed.meta?.innerInstructions
  if (inner) {
    for (const group of inner) {
      for (const ix of group.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]) {
        visitIx(ix)
      }
    }
  }

  return toFounder
}

export type VerifyPaymentResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'failed' | 'wrong_amounts' | 'wrong_destinations' }

export function verifyGen2PresalePayments(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  founderA: string
  founderB: string
  expectA: bigint
  expectB: bigint
}): VerifyPaymentResult {
  const { parsed, buyerWallet, founderA, founderB, expectA, expectB } = params
  if (parsed.meta?.err) {
    return { ok: false, reason: 'failed' }
  }
  const buyerNorm = normalizeSolanaWalletAddress(buyerWallet)
  const fa = normalizeSolanaWalletAddress(founderA)
  const fb = normalizeSolanaWalletAddress(founderB)
  if (!buyerNorm || !fa || !fb) {
    return { ok: false, reason: 'wrong_destinations' }
  }

  const map = collectTransfersFromBuyer(parsed, buyerNorm)
  const gotA = map.get(fa) ?? 0n
  const gotB = map.get(fb) ?? 0n

  if (gotA !== expectA || gotB !== expectB) {
    return { ok: false, reason: 'wrong_amounts' }
  }

  // Do not require the buyer to send SOL *only* to founders. Wallets often attach extra
  // system transfers in the same signature (tips, rent, etc.) while founders still receive
  // the exact presale lamports — those payments must still record.

  return { ok: true }
}

/** When live SOL/USD moved between build and confirm, re-verify using on-chain amounts + founder split. */
export type ChainAlignedPayment =
  | {
      ok: true
      totalLamports: bigint
      founderALamports: bigint
      founderBLamports: bigint
      /** Implied USD/SOL from integer lamports per spot and configured USDC spot price */
      impliedSolUsd: number
    }
  | { ok: false; reason: 'failed' | 'wrong_destinations' | 'split_mismatch' | 'bad_quantity' | 'unreasonable_unit' }

/**
 * Read buyer → founder SOL transfers and verify the configured split, without assuming spot count.
 * Used to infer how many spots were paid for from the total lamports.
 */
export type ParseFounderPaymentTotalResult =
  | { ok: true; total: bigint; founderALamports: bigint; founderBLamports: bigint }
  | { ok: false; reason: 'failed' | 'wrong_destinations' | 'split_mismatch' }

export function parseGen2PresaleFounderPaymentTotals(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  founderA: string
  founderB: string
  pctA: number
  pctB: number
}): ParseFounderPaymentTotalResult {
  const { parsed, buyerWallet, founderA, founderB, pctA, pctB } = params
  if (parsed.meta?.err) {
    return { ok: false, reason: 'failed' }
  }
  const buyerNorm = normalizeSolanaWalletAddress(buyerWallet)
  const fa = normalizeSolanaWalletAddress(founderA)
  const fb = normalizeSolanaWalletAddress(founderB)
  if (!buyerNorm || !fa || !fb) {
    return { ok: false, reason: 'wrong_destinations' }
  }

  const map = collectTransfersFromBuyer(parsed, buyerNorm)
  const gotA = map.get(fa) ?? 0n
  const gotB = map.get(fb) ?? 0n
  const total = gotA + gotB
  if (total <= 0n) {
    return { ok: false, reason: 'split_mismatch' }
  }

  const pA = BigInt(pctA)
  const pB = BigInt(pctB)
  if (pA + pB !== 100n) {
    return { ok: false, reason: 'split_mismatch' }
  }
  const expectA = (total * pA) / 100n
  const expectB = total - expectA
  if (gotA !== expectA || gotB !== expectB) {
    return { ok: false, reason: 'split_mismatch' }
  }

  return { ok: true, total, founderALamports: gotA, founderBLamports: gotB }
}

export function verifyGen2PresalePaymentChainAligned(params: {
  parsed: ParsedTransactionWithMeta
  buyerWallet: string
  founderA: string
  founderB: string
  pctA: number
  pctB: number
  priceUsdc: number
  quantity: number
}): ChainAlignedPayment {
  const { parsed, buyerWallet, founderA, founderB, pctA, pctB, priceUsdc, quantity } = params
  if (parsed.meta?.err) {
    return { ok: false, reason: 'failed' }
  }
  const buyerNorm = normalizeSolanaWalletAddress(buyerWallet)
  const fa = normalizeSolanaWalletAddress(founderA)
  const fb = normalizeSolanaWalletAddress(founderB)
  if (!buyerNorm || !fa || !fb) {
    return { ok: false, reason: 'wrong_destinations' }
  }

  const map = collectTransfersFromBuyer(parsed, buyerNorm)

  const gotA = map.get(fa) ?? 0n
  const gotB = map.get(fb) ?? 0n
  const total = gotA + gotB
  if (total <= 0n) {
    return { ok: false, reason: 'split_mismatch' }
  }

  const pA = BigInt(pctA)
  const pB = BigInt(pctB)
  if (pA + pB !== 100n) {
    return { ok: false, reason: 'split_mismatch' }
  }
  const expectA = (total * pA) / 100n
  const expectB = total - expectA
  if (gotA !== expectA || gotB !== expectB) {
    return { ok: false, reason: 'split_mismatch' }
  }

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: 'bad_quantity' }
  }
  const q = BigInt(quantity)
  if (total % q !== 0n) {
    return { ok: false, reason: 'bad_quantity' }
  }
  const unit = total / q
  const unitSol = Number(unit) / LAMPORTS_PER_SOL
  if (!Number.isFinite(unitSol) || unitSol <= 0) {
    return { ok: false, reason: 'unreasonable_unit' }
  }
  /** Reject only absurd totals (split + divisibility are the real checks). High SOL/USD yields small SOL per spot. */
  if (unitSol < 0.0005 || unitSol > 100) {
    return { ok: false, reason: 'unreasonable_unit' }
  }

  const impliedSolUsd = priceUsdc / unitSol
  if (!Number.isFinite(impliedSolUsd) || impliedSolUsd <= 0) {
    return { ok: false, reason: 'unreasonable_unit' }
  }

  return {
    ok: true,
    totalLamports: total,
    founderALamports: gotA,
    founderBLamports: gotB,
    impliedSolUsd,
  }
}

export async function fetchParsedTransactionConfirmed(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  /** v0 and legacy messages use different `maxSupportedTransactionVersion`; RPC cluster must match the tx. */
  const commitments = ['confirmed', 'finalized'] as const
  for (const commitment of commitments) {
    for (const maxSupportedTransactionVersion of [0] as const) {
      try {
        const tx = await connection.getParsedTransaction(signature, { commitment, maxSupportedTransactionVersion })
        if (tx) return tx
      } catch {
        // retry
      }
    }
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment,
        maxSupportedTransactionVersion: 'legacy',
      } as never)
      if (tx) return tx
    } catch {
      // retry
    }
  }
  return null
}

/**
 * `getParsedTransaction` uses {@link ParsedMessage}: `accountKeys[0]` may be
 * `{ pubkey, signer, writable }`, not a bare {@link PublicKey}. Legacy /
 * versioned compiled messages use PublicKey at index 0.
 */
function accountKeyAtIndexToPublicKey(key: unknown): PublicKey | null {
  if (key == null) return null
  if (key instanceof PublicKey) return key
  if (typeof key === 'object' && 'pubkey' in key) {
    const pk = (key as { pubkey: PublicKey | string }).pubkey
    if (pk instanceof PublicKey) return pk
    if (typeof pk === 'string' && pk.trim()) {
      try {
        return new PublicKey(pk.trim())
      } catch {
        return null
      }
    }
  }
  if (typeof key === 'string' && key.trim()) {
    try {
      return new PublicKey(key.trim())
    } catch {
      return null
    }
  }
  return null
}

/** Legacy message fee payer (signer index 0). */
export function getFeePayerPublicKey(parsed: ParsedTransactionWithMeta): PublicKey | null {
  try {
    const msg = parsed.transaction.message as unknown as {
      getAccountKeys?: (opts: { accountKeysFromLookups?: unknown }) => { get: (i: number) => PublicKey | undefined }
      accountKeys?: unknown[]
      staticAccountKeys?: PublicKey[]
    }
    if (typeof msg.getAccountKeys === 'function') {
      const keys = msg.getAccountKeys({
        accountKeysFromLookups: parsed.meta?.loadedAddresses,
      })
      const feePayer = keys.get(0)
      return feePayer ?? null
    }
    const rawFirst = msg.staticAccountKeys?.[0] ?? msg.accountKeys?.[0]
    return accountKeyAtIndexToPublicKey(rawFirst)
  } catch {
    return null
  }
}

/** Fee payer should match buyer for simple UX verification. */
export function feePayerMatchesBuyer(parsed: ParsedTransactionWithMeta, buyer: PublicKey): boolean {
  const fp = getFeePayerPublicKey(parsed)
  return !!fp && fp.equals(buyer)
}

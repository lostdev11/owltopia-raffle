import {
  Connection,
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

  // Reject if buyer sent SOL to any pubkey other than the two founders (same tx)
  for (const [dest, v] of map) {
    if (v === 0n) continue
    if (dest !== fa && dest !== fb) {
      return { ok: false, reason: 'wrong_destinations' }
    }
  }

  return { ok: true }
}

export async function fetchParsedTransactionConfirmed(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  const opts = [
    { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'finalized' as const, maxSupportedTransactionVersion: 0 },
  ]
  for (const o of opts) {
    try {
      const tx = await connection.getParsedTransaction(signature, o)
      if (tx) return tx
    } catch {
      // retry
    }
  }
  return null
}

/** Fee payer should match buyer for simple UX verification. */
export function feePayerMatchesBuyer(parsed: ParsedTransactionWithMeta, buyer: PublicKey): boolean {
  try {
    const msg = parsed.transaction.message as unknown as {
      getAccountKeys?: (opts: { accountKeysFromLookups?: unknown }) => { get: (i: number) => PublicKey | undefined }
      accountKeys?: PublicKey[]
      staticAccountKeys?: PublicKey[]
    }
    if (typeof msg.getAccountKeys === 'function') {
      const keys = msg.getAccountKeys({
        accountKeysFromLookups: parsed.meta?.loadedAddresses,
      })
      const feePayer = keys.get(0)
      return !!feePayer && feePayer.equals(buyer)
    }
    const first = msg.staticAccountKeys?.[0] ?? msg.accountKeys?.[0]
    return !!first && first.equals(buyer)
  } catch {
    return false
  }
}

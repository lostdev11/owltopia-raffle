/**
 * Verify a Solana transaction pays USDC to the platform treasury and includes an exact memo (e.g. OWLGW:REFCODE).
 */
import { PublicKey } from '@solana/web3.js'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'

function resolveUsdcMint(): PublicKey {
  const raw = process.env.DISCORD_PARTNER_USDC_MINT?.trim()
  if (raw) {
    try {
      return new PublicKey(raw)
    } catch {
      // fall through
    }
  }
  const info = getTokenInfo('USDC')
  if (!info.mintAddress) throw new Error('USDC mint not configured')
  return new PublicKey(info.mintAddress)
}

function treasuryWallet(): PublicKey {
  const w =
    process.env.DISCORD_BOT_USDC_TREASURY_WALLET?.trim() ||
    process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
    ''
  if (!w) throw new Error('DISCORD_BOT_USDC_TREASURY_WALLET or RAFFLE_RECIPIENT_WALLET must be set')
  return new PublicKey(w)
}

/** Cheap check: serialized tx includes the memo string (matches Memo program output in logs / parsed ix). */
function transactionContainsExactMemo(tx: ParsedTransactionWithMeta, memo: string): boolean {
  if (!memo) return false
  return JSON.stringify(tx).includes(memo)
}

export type VerifyDiscordPartnerUsdcResult =
  | { ok: true }
  | { ok: false; error: string }

/** Find OWLGW: reference memos embedded in RPC JSON (Memo program output, parsed ix, etc.). */
export function extractOwlgwMemosFromParsedTx(tx: ParsedTransactionWithMeta): string[] {
  const s = JSON.stringify(tx)
  const re = /OWLGW:[A-F0-9]+/g
  return [...new Set(s.match(re) ?? [])]
}

/**
 * Confirms treasury USDC ATA balance increased by expected amount (±1 atom) and memo appears in the tx.
 */
export async function verifyDiscordPartnerUsdcPayment(params: {
  signature: string
  expectedUsdc: number
  expectedMemo: string
  /** When already loaded (e.g. to resolve payment intent), pass to avoid a second RPC round trip. */
  parsedTransaction?: ParsedTransactionWithMeta | null
}): Promise<VerifyDiscordPartnerUsdcResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing signature' }

  let treasury: PublicKey
  let usdcMint: PublicKey
  try {
    treasury = treasuryWallet()
    usdcMint = resolveUsdcMint()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Config error' }
  }

  const decimals = getTokenInfo('USDC').decimals
  const expectedRaw = BigInt(Math.round(params.expectedUsdc * Math.pow(10, decimals)))
  if (expectedRaw <= 0n) return { ok: false, error: 'Invalid expected amount' }

  const connection = getSolanaConnection()
  const tx =
    params.parsedTransaction ??
    (await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    }))

  if (!tx) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }
  const meta = tx.meta
  if (!meta || meta.err) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }

  if (!transactionContainsExactMemo(tx, params.expectedMemo)) {
    return {
      ok: false,
      error:
        `Memo "${params.expectedMemo}" not found in transaction. Add a Solana memo instruction with exactly that text in the same transaction as your USDC transfer.`,
    }
  }

  const treasuryB58 = treasury.toBase58()
  const mintB58 = usdcMint.toBase58()
  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const postB = post.find((b) => b.mint === mintB58 && b.owner === treasuryB58)
  const preB = pre.find((b) => b.mint === mintB58 && b.owner === treasuryB58)
  const postAmt = postB?.uiTokenAmount?.amount
  if (postAmt == null) {
    return { ok: false, error: 'Could not detect USDC balance change on treasury wallet in this transaction' }
  }
  const preAmt = preB?.uiTokenAmount?.amount != null ? preB.uiTokenAmount.amount : '0'
  const increase = BigInt(postAmt) - BigInt(preAmt)
  const tolerance = 1n
  if (increase < expectedRaw - tolerance || increase > expectedRaw + tolerance) {
    return {
      ok: false,
      error: `USDC amount mismatch: expected ${params.expectedUsdc} USDC to treasury, observed raw delta ${increase.toString()}`,
    }
  }

  return { ok: true }
}

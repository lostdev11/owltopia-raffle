/**
 * Dedicated Gen Owl rev-share pool wallet (SOL/USDC claims).
 * Separate from raffle funds escrow — fund via admin deposit only.
 *
 * GEN_OWL_REV_SHARE_POOL_SECRET_KEY — JSON byte array or base58 (same formats as FUNDS_ESCROW).
 * Optional GEN_OWL_REV_SHARE_POOL_WALLET must match the secret's public key when set.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSolanaConnection, getSolanaReadConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'
import {
  evaluateGenOwlRevSharePoolAffordabilityFromBalances,
  GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS,
  type GenOwlRevSharePoolAffordability,
} from '@/lib/nesting/gen-owl-rev-share-pool-affordability'

export {
  evaluateGenOwlRevSharePoolAffordabilityFromBalances,
  GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS,
  type GenOwlRevSharePoolAffordability,
}

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const
const SOL_FEE_BUFFER_LAMPORTS = GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS

function parsePoolKeypair(): Keypair | null {
  const raw = process.env.GEN_OWL_REV_SHARE_POOL_SECRET_KEY?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(raw))
  } catch {
    return null
  }
}

let poolKeypairCache: Keypair | null | undefined = undefined

export function getGenOwlRevSharePoolKeypair(): Keypair | null {
  if (poolKeypairCache !== undefined) return poolKeypairCache
  const kp = parsePoolKeypair()
  if (!kp) {
    poolKeypairCache = null
    return null
  }
  const expected = process.env.GEN_OWL_REV_SHARE_POOL_WALLET?.trim()
  if (expected) {
    try {
      if (!kp.publicKey.equals(new PublicKey(expected))) {
        console.warn(
          '[gen-owl-rev-share-pool] GEN_OWL_REV_SHARE_POOL_SECRET_KEY public key does not match GEN_OWL_REV_SHARE_POOL_WALLET — payouts disabled until they match.'
        )
        poolKeypairCache = null
        return null
      }
    } catch {
      poolKeypairCache = null
      return null
    }
  }
  poolKeypairCache = kp
  return kp
}

export function getGenOwlRevSharePoolPublicKey(): string | null {
  const kp = getGenOwlRevSharePoolKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

export type GenOwlRevSharePoolBalances = {
  configured: boolean
  address: string | null
  sol_lamports: number | null
  sol: number | null
  usdc: number | null
}

/** Live on-chain SOL/USDC balances for the dedicated rev-share pool (read RPC). */
export async function getGenOwlRevSharePoolBalances(): Promise<GenOwlRevSharePoolBalances> {
  const kp = getGenOwlRevSharePoolKeypair()
  if (!kp) {
    return { configured: false, address: null, sol_lamports: null, sol: null, usdc: null }
  }

  const address = kp.publicKey.toBase58()
  const readConn = getSolanaReadConnection()
  let solLamports: number | null = null
  try {
    solLamports = await readConn.getBalance(kp.publicKey, 'confirmed')
  } catch (e) {
    console.warn(
      '[gen-owl-rev-share-pool] getBalance failed',
      e instanceof Error ? e.message : e
    )
  }

  let usdc: number | null = null
  try {
    const tokenInfo = getTokenInfo('USDC')
    if (tokenInfo.mintAddress) {
      const mint = new PublicKey(tokenInfo.mintAddress)
      const programId = await getPoolTokenProgramForMint(mint, kp.publicKey)
      if (programId) {
        const ata = await getAssociatedTokenAddress(
          mint,
          kp.publicKey,
          false,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const acct = await getAccount(readConn, ata, 'confirmed', programId)
        usdc = Number(acct.amount) / Math.pow(10, tokenInfo.decimals)
      } else {
        usdc = 0
      }
    }
  } catch {
    usdc = null
  }

  return {
    configured: true,
    address,
    sol_lamports: solLamports,
    sol: solLamports != null ? solLamports / LAMPORTS_PER_SOL : null,
    usdc,
  }
}

/**
 * Whether the pool can cover a SOL/USDC payout (incl. network fee buffer).
 * Used to refuse claims before users pay the platform fee.
 */
export async function assessGenOwlRevSharePoolAffordability(params: {
  amount_sol: number
  amount_usdc: number
}): Promise<GenOwlRevSharePoolAffordability> {
  const balances = await getGenOwlRevSharePoolBalances()
  return evaluateGenOwlRevSharePoolAffordabilityFromBalances({
    amount_sol: params.amount_sol,
    amount_usdc: params.amount_usdc,
    hold_sol: balances.sol,
    hold_usdc: balances.usdc,
    configured: balances.configured,
  })
}

async function getPoolTokenProgramForMint(
  mint: PublicKey,
  poolOwner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const connection = getSolanaReadConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        poolOwner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      await getAccount(connection, ata, 'confirmed', programId)
      return programId
    } catch {
      // try next
    }
  }
  return null
}

function formatRawTokenAmount(raw: bigint, decimals: number): string {
  return (Number(raw) / Math.pow(10, decimals)).toString()
}

export type GenOwlRevSharePoolPayoutResult =
  | { ok: true; signature: string }
  | { ok: false; error: string }

async function buildUsdcTransferIxs(params: {
  poolPubkey: PublicKey
  recipientPk: PublicKey
  amount: number
}): Promise<{ ok: true; ixs: TransactionInstruction[] } | { ok: false; error: string }> {
  const readConn = getSolanaReadConnection()
  const tokenInfo = getTokenInfo('USDC')
  if (!tokenInfo.mintAddress) {
    return { ok: false, error: 'USDC mint not configured.' }
  }
  const mint = new PublicKey(tokenInfo.mintAddress)
  const decimals = tokenInfo.decimals
  const programId = await getPoolTokenProgramForMint(mint, params.poolPubkey)
  if (!programId) {
    return { ok: false, error: 'Rev share pool has no USDC token account for this mint. Deposit USDC first.' }
  }

  const raw = BigInt(Math.round(params.amount * Math.pow(10, decimals)))
  if (raw <= 0n) return { ok: false, error: 'Nothing to pay.' }

  const fromAta = await getAssociatedTokenAddress(
    mint,
    params.poolPubkey,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const toAta = await getAssociatedTokenAddress(
    mint,
    params.recipientPk,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  try {
    const acct = await getAccount(readConn, fromAta, 'confirmed', programId)
    if (acct.amount < raw) {
      return {
        ok: false,
        error:
          `Rev share pool is short of USDC for this payout: it needs ` +
          `${formatRawTokenAmount(raw, decimals)} USDC but holds ` +
          `${formatRawTokenAmount(acct.amount, decimals)}. Ask an admin to deposit into the rev-share pool.`,
      }
    }
  } catch {
    // send still validates
  }

  const ixs: TransactionInstruction[] = []
  try {
    await getAccount(readConn, toAta, 'confirmed', programId)
  } catch {
    ixs.push(
      createAssociatedTokenAccountInstruction(
        params.poolPubkey,
        toAta,
        params.recipientPk,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  ixs.push(createTransferInstruction(fromAta, toAta, params.poolPubkey, raw, [], programId))
  return { ok: true, ixs }
}

/** Send SOL or USDC from the dedicated rev-share pool to a claimer. */
export async function payoutCryptoFromGenOwlRevSharePool(params: {
  recipientWallet: string
  amount: number
  currency: 'SOL' | 'USDC'
}): Promise<GenOwlRevSharePoolPayoutResult> {
  const kp = getGenOwlRevSharePoolKeypair()
  if (!kp) {
    return {
      ok: false,
      error:
        'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY (and matching GEN_OWL_REV_SHARE_POOL_WALLET if used).',
    }
  }

  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Invalid payout amount.' }
  }

  const connection = getSolanaConnection()
  const poolPubkey = kp.publicKey
  const recipientPk = new PublicKey(params.recipientWallet.trim())

  try {
    if (params.currency === 'SOL') {
      const lamports = Math.round(amount * LAMPORTS_PER_SOL)
      if (lamports <= 0) return { ok: false, error: 'Nothing to pay.' }

      let balance: number
      try {
        balance = await getSolanaReadConnection().getBalance(poolPubkey, 'confirmed')
      } catch {
        balance = Number.POSITIVE_INFINITY
      }
      const needed = lamports + SOL_FEE_BUFFER_LAMPORTS
      if (Number.isFinite(balance) && balance < needed) {
        return {
          ok: false,
          error:
            `Rev share pool is short of SOL for this payout: it needs about ` +
            `${(needed / LAMPORTS_PER_SOL).toFixed(5)} SOL (incl. network fee) but holds ` +
            `${(balance / LAMPORTS_PER_SOL).toFixed(5)}. Ask an admin to deposit into the rev-share pool.`,
        }
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: poolPubkey,
          toPubkey: recipientPk,
          lamports,
        })
      )
      const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
        commitment: 'confirmed',
        maxRetries: 3,
      })
      return { ok: true, signature: sig }
    }

    const built = await buildUsdcTransferIxs({ poolPubkey, recipientPk, amount })
    if (!built.ok) return built

    const tx = new Transaction()
    for (const ix of built.ixs) tx.add(ix)

    const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return { ok: true, signature: sig }
  } catch (e) {
    console.error(
      '[gen-owl-rev-share-pool] payout failed',
      { pool: poolPubkey.toBase58(), currency: params.currency, amount },
      e
    )
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Prefer one pool-signed transaction for SOL + USDC totals (batch claim).
 * Falls back to separate currency payouts when only one currency is needed.
 */
export async function payoutCombinedCryptoFromGenOwlRevSharePool(params: {
  recipientWallet: string
  amount_sol: number
  amount_usdc: number
}): Promise<{
  sol_signature: string | null
  usdc_signature: string | null
  payout_errors: string[]
}> {
  const amountSol = Number(params.amount_sol) || 0
  const amountUsdc = Number(params.amount_usdc) || 0
  const needSol = amountSol > 0
  const needUsdc = amountUsdc > 0

  if (!needSol && !needUsdc) {
    return { sol_signature: null, usdc_signature: null, payout_errors: ['Nothing to pay.'] }
  }

  // Single-currency: reuse existing path.
  if (needSol !== needUsdc) {
    const res = await payoutCryptoFromGenOwlRevSharePool({
      recipientWallet: params.recipientWallet,
      amount: needSol ? amountSol : amountUsdc,
      currency: needSol ? 'SOL' : 'USDC',
    })
    if (!res.ok) {
      return {
        sol_signature: null,
        usdc_signature: null,
        payout_errors: [res.error],
      }
    }
    return {
      sol_signature: needSol ? res.signature : null,
      usdc_signature: needUsdc ? res.signature : null,
      payout_errors: [],
    }
  }

  const kp = getGenOwlRevSharePoolKeypair()
  if (!kp) {
    return {
      sol_signature: null,
      usdc_signature: null,
      payout_errors: [
        'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY (and matching GEN_OWL_REV_SHARE_POOL_WALLET if used).',
      ],
    }
  }

  const poolPubkey = kp.publicKey
  const recipientPk = new PublicKey(params.recipientWallet.trim())
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)
  if (lamports <= 0) {
    return { sol_signature: null, usdc_signature: null, payout_errors: ['Invalid SOL payout amount.'] }
  }

  try {
    let balance: number
    try {
      balance = await getSolanaReadConnection().getBalance(poolPubkey, 'confirmed')
    } catch {
      balance = Number.POSITIVE_INFINITY
    }
    const needed = lamports + SOL_FEE_BUFFER_LAMPORTS * 2
    if (Number.isFinite(balance) && balance < needed) {
      return {
        sol_signature: null,
        usdc_signature: null,
        payout_errors: [
          `Rev share pool is short of SOL for this payout: it needs about ` +
            `${(needed / LAMPORTS_PER_SOL).toFixed(5)} SOL (incl. network fee) but holds ` +
            `${(balance / LAMPORTS_PER_SOL).toFixed(5)}. Ask an admin to deposit into the rev-share pool.`,
        ],
      }
    }

    const usdcBuilt = await buildUsdcTransferIxs({
      poolPubkey,
      recipientPk,
      amount: amountUsdc,
    })
    if (!usdcBuilt.ok) {
      return { sol_signature: null, usdc_signature: null, payout_errors: [usdcBuilt.error] }
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: poolPubkey,
        toPubkey: recipientPk,
        lamports,
      })
    )
    for (const ix of usdcBuilt.ixs) tx.add(ix)

    const sig = await sendAndConfirmTransaction(getSolanaConnection(), tx, [kp], {
      commitment: 'confirmed',
      maxRetries: 3,
    })
    return { sol_signature: sig, usdc_signature: sig, payout_errors: [] }
  } catch (e) {
    console.error(
      '[gen-owl-rev-share-pool] combined payout failed',
      { pool: poolPubkey.toBase58(), amountSol, amountUsdc },
      e
    )
    // Fallback: try separate currency txs so a combined-tx size/ix issue does not block claims.
    const errors: string[] = []
    let solSig: string | null = null
    let usdcSig: string | null = null
    const solRes = await payoutCryptoFromGenOwlRevSharePool({
      recipientWallet: params.recipientWallet,
      amount: amountSol,
      currency: 'SOL',
    })
    if (solRes.ok) solSig = solRes.signature
    else errors.push(solRes.error)
    const usdcRes = await payoutCryptoFromGenOwlRevSharePool({
      recipientWallet: params.recipientWallet,
      amount: amountUsdc,
      currency: 'USDC',
    })
    if (usdcRes.ok) usdcSig = usdcRes.signature
    else errors.push(usdcRes.error)
    if (!solSig && !usdcSig) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.unshift(msg)
    }
    return { sol_signature: solSig, usdc_signature: usdcSig, payout_errors: errors }
  }
}

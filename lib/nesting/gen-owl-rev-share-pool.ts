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

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const
const SOL_FEE_BUFFER_LAMPORTS = 15_000

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

    const readConn = getSolanaReadConnection()
    const tokenInfo = getTokenInfo('USDC')
    if (!tokenInfo.mintAddress) {
      return { ok: false, error: 'USDC mint not configured.' }
    }
    const mint = new PublicKey(tokenInfo.mintAddress)
    const decimals = tokenInfo.decimals
    const programId = await getPoolTokenProgramForMint(mint, poolPubkey)
    if (!programId) {
      return { ok: false, error: 'Rev share pool has no USDC token account for this mint. Deposit USDC first.' }
    }

    const raw = BigInt(Math.round(amount * Math.pow(10, decimals)))
    if (raw <= 0n) return { ok: false, error: 'Nothing to pay.' }

    const fromAta = await getAssociatedTokenAddress(
      mint,
      poolPubkey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const toAta = await getAssociatedTokenAddress(
      mint,
      recipientPk,
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

    const tx = new Transaction()
    try {
      await getAccount(readConn, toAta, 'confirmed', programId)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          poolPubkey,
          toAta,
          recipientPk,
          mint,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
    }
    tx.add(createTransferInstruction(fromAta, toAta, poolPubkey, raw, [], programId))

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

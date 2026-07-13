import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

function parseSolanaSecretKey(raw: string | undefined): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

let treasuryCache: Keypair | null | undefined

function getMarketplaceTreasuryKeypair(): Keypair | null {
  if (treasuryCache !== undefined) return treasuryCache
  const kp =
    parseSolanaSecretKey(process.env.DISCORD_MARKETPLACE_OWL_TREASURY_SECRET_KEY) ??
    parseSolanaSecretKey(process.env.NESTING_OWL_REWARD_TREASURY_SECRET_KEY)
  treasuryCache = kp ?? null
  return treasuryCache
}

async function tokenProgramForSplMint(
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const connection = getSolanaConnection()
  const info = await connection.getAccountInfo(mint, 'confirmed')
  if (!info) return null
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
  return null
}

export type MarketplaceFulfillOutcome =
  | { kind: 'sent'; signature: string }
  | { kind: 'skipped'; reason: 'zero_amount' | 'treasury_not_configured' | 'owl_disabled' }
  | { kind: 'failed'; error: string }

/**
 * Sends OWL from the marketplace treasury to the buyer's linked wallet after a shop purchase.
 */
export async function fulfillMarketplaceOwlDelivery(params: {
  recipientWallet: string
  owlAmountUi: number
}): Promise<MarketplaceFulfillOutcome> {
  if (!Number.isFinite(params.owlAmountUi) || params.owlAmountUi <= 0) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }
  if (!isOwlEnabled()) {
    return { kind: 'skipped', reason: 'owl_disabled' }
  }

  const treasury = getMarketplaceTreasuryKeypair()
  if (!treasury) {
    return { kind: 'skipped', reason: 'treasury_not_configured' }
  }

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { kind: 'failed', error: 'OWL mint is not configured' }
  }

  let recipient: PublicKey
  try {
    recipient = new PublicKey(params.recipientWallet.trim())
  } catch {
    return { kind: 'failed', error: 'Invalid recipient wallet' }
  }

  const mint = new PublicKey(owl.mintAddress)
  const amountRaw = BigInt(Math.round(params.owlAmountUi * Math.pow(10, owl.decimals)))
  if (amountRaw <= 0n) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }

  const connection = getSolanaConnection()
  const treasuryPk = treasury.publicKey

  const programId = await tokenProgramForSplMint(mint)
  if (!programId) {
    return {
      kind: 'failed',
      error:
        'OWL mint is missing on-chain or is not SPL Token / Token-2022. Verify NEXT_PUBLIC_OWL_MINT_ADDRESS matches this cluster.',
    }
  }

  const fromAta = await getAssociatedTokenAddress(
    mint,
    treasuryPk,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const toAta = await getAssociatedTokenAddress(
    mint,
    recipient,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  const splAtaExists = async (ata: PublicKey): Promise<boolean> => {
    try {
      await getAccount(connection, ata, 'confirmed', programId)
      return true
    } catch {
      return false
    }
  }

  const tx = new Transaction()
  const [{ blockhash, lastValidBlockHeight }, fromAtaExists, toAtaExists] = await Promise.all([
    connection.getLatestBlockhash('confirmed'),
    splAtaExists(fromAta),
    splAtaExists(toAta),
  ])

  if (!fromAtaExists) {
    return { kind: 'failed', error: 'Marketplace treasury has no OWL token account. Fund the treasury first.' }
  }
  if (!toAtaExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        treasuryPk,
        toAta,
        recipient,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, treasuryPk, amountRaw, [], programId))

  try {
    tx.recentBlockhash = blockhash
    tx.feePayer = treasuryPk
    const signature = await connection.sendTransaction(tx, [treasury], {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'processed')
    return { kind: 'sent', signature }
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : 'OWL marketplace transfer failed' }
  }
}

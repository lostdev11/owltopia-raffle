import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getNestingOwlRewardTreasuryKeypair } from '@/lib/nesting/reward-treasury-keypair'
import { getNestingConnection, getNestingReadConnection } from '@/lib/solana/nesting/client'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

/** SPL Token vs Token-2022 from on-chain mint owner (does not require an ATA to exist yet). */
async function tokenProgramForSplMint(
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const read = getNestingReadConnection()
  const info = await read.getAccountInfo(mint, 'confirmed')
  if (!info) return null
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
  return null
}

export type OwlRewardClaimTransferOutcome =
  | { kind: 'sent'; signature: string }
  | { kind: 'skipped'; reason: 'not_owl_token_rewards' | 'zero_amount' | 'treasury_not_configured' | 'owl_disabled' }
  | { kind: 'failed'; error: string }

/**
 * Sends claimed OWL rewards from the configured reward treasury to the user wallet.
 * When the treasury key is not configured, returns `skipped` and callers should still record the DB claim only.
 */
export async function tryTransferOwlRewardClaim(params: {
  pool: StakingPoolRow
  recipientWallet: string
  claimAmountUi: number
}): Promise<OwlRewardClaimTransferOutcome> {
  if ((params.pool.reward_token ?? '').trim().toUpperCase() !== 'OWL') {
    return { kind: 'skipped', reason: 'not_owl_token_rewards' }
  }
  if (!Number.isFinite(params.claimAmountUi) || params.claimAmountUi <= 0) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }
  if (!isOwlEnabled()) {
    return { kind: 'skipped', reason: 'owl_disabled' }
  }

  const treasury = getNestingOwlRewardTreasuryKeypair()
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
  const amountRaw = BigInt(Math.round(params.claimAmountUi * Math.pow(10, owl.decimals)))
  if (amountRaw <= 0n) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }

  const readConn = getNestingReadConnection()
  const connection = getNestingConnection()
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

  const splAtaExists = async (ata: typeof fromAta): Promise<boolean> => {
    try {
      await getAccount(readConn, ata, 'confirmed', programId)
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
    tx.add(
      createAssociatedTokenAccountInstruction(
        treasuryPk,
        fromAta,
        treasuryPk,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
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
    // Processed is enough for treasury→user SPL payouts; avoids an extra confirmed round-trip.
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'processed')
    return { kind: 'sent', signature }
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : 'OWL reward transfer failed' }
  }
}

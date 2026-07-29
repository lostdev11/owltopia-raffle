import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  debitPartnerRewardPayout,
  partnerRewardAvailableUi,
} from '@/lib/db/staking-pools'
import {
  getPartnerNestRewardVaultKeypair,
  isPartnerTokenRewardPool,
} from '@/lib/nesting/partner-reward-vault'
import { getNestingConnection, getNestingReadConnection } from '@/lib/solana/nesting/client'
import type { OwlRewardClaimTransferOutcome } from '@/lib/nesting/owl-reward-claim-transfer'

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

/**
 * Pay partner_token nest rewards from the platform reward vault ATA (funded by partner deposits).
 */
export async function tryTransferPartnerRewardClaim(params: {
  pool: StakingPoolRow
  recipientWallet: string
  claimAmountUi: number
}): Promise<OwlRewardClaimTransferOutcome> {
  if (!isPartnerTokenRewardPool(params.pool)) {
    return { kind: 'skipped', reason: 'not_owl_token_rewards' }
  }
  if (!Number.isFinite(params.claimAmountUi) || params.claimAmountUi <= 0) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }

  const mintStr = params.pool.reward_mint?.trim()
  if (!mintStr) {
    return { kind: 'failed', error: 'Partner reward mint is not configured on this nest.' }
  }

  const available = partnerRewardAvailableUi(params.pool)
  if (params.claimAmountUi > available + 1e-9) {
    return {
      kind: 'failed',
      error: `Not enough partner rewards deposited for this nest (need ${params.claimAmountUi}, available ${available}). The partner must fund the reward pool.`,
    }
  }

  const treasury = getPartnerNestRewardVaultKeypair()
  if (!treasury) {
    return { kind: 'skipped', reason: 'treasury_not_configured' }
  }

  let recipient: PublicKey
  let mint: PublicKey
  try {
    recipient = new PublicKey(params.recipientWallet.trim())
    mint = new PublicKey(mintStr)
  } catch {
    return { kind: 'failed', error: 'Invalid recipient wallet or reward mint' }
  }

  const programId = await tokenProgramForSplMint(mint)
  if (!programId) {
    return {
      kind: 'failed',
      error: 'Partner reward mint is missing on-chain or is not SPL Token / Token-2022.',
    }
  }

  const readConn = getNestingReadConnection()
  const mintInfo = await getMint(readConn, mint, 'confirmed', programId)
  const decimals =
    params.pool.reward_decimals != null && Number.isInteger(Number(params.pool.reward_decimals))
      ? Number(params.pool.reward_decimals)
      : mintInfo.decimals

  const amountRaw = BigInt(Math.round(params.claimAmountUi * Math.pow(10, decimals)))
  if (amountRaw <= 0n) {
    return { kind: 'skipped', reason: 'zero_amount' }
  }

  const connection = getNestingConnection()
  const treasuryPk = treasury.publicKey

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
    return {
      kind: 'failed',
      error:
        'Partner reward vault has no token account yet. The partner must deposit rewards from their Nesting hub first.',
    }
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
    // Reserve ledger balance before send so concurrent claims cannot overdraw.
    await debitPartnerRewardPayout(params.pool.id, params.claimAmountUi)
  } catch (e) {
    return {
      kind: 'failed',
      error: e instanceof Error ? e.message : 'Partner reward vault balance check failed.',
    }
  }

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
    // Do not credit the reservation back after broadcast — the transfer may have landed.
    // Ops reconcile partner_reward_paid vs on-chain vault balance if needed.
    return {
      kind: 'failed',
      error: e instanceof Error ? e.message : 'Partner reward transfer failed',
    }
  }
}

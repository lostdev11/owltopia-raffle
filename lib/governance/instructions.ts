import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { governanceInstructionCoder } from '@/lib/governance/coders'
import {
  globalConfigPda,
  proposalPda,
  userStakePda,
  vaultTokenPda,
  voteReceiptPda,
} from '@/lib/governance/pdas'

const SYSVAR_RENT = new PublicKey('SysvarRent111111111111111111111111111111111')

function ixData(name: string, data: Record<string, unknown>): Buffer {
  const encoded = governanceInstructionCoder.encode(name, data)
  if (!encoded) throw new Error(`Failed to encode instruction: ${name}`)
  return Buffer.from(encoded)
}

function keys(...metas: AccountMeta[]): AccountMeta[] {
  return metas
}

export function buildInitializeInstruction(params: {
  programId: PublicKey
  authority: PublicKey
  owlMint: PublicKey
  minStakeToPropose: BN
  voteStakeWeightBps: BN
}): TransactionInstruction {
  const [global] = globalConfigPda(params.programId)
  const [vault] = vaultTokenPda(global, params.programId)
  const data = ixData('initialize', {
    min_stake_to_propose: params.minStakeToPropose,
    vote_stake_weight_bps: params.voteStakeWeightBps,
  })
  return new TransactionInstruction({
    programId: params.programId,
    keys: keys(
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: params.owlMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false }
    ),
    data,
  })
}

export function buildStakeInstruction(params: {
  programId: PublicKey
  user: PublicKey
  owlMint: PublicKey
  userOwlAta: PublicKey
  amount: BN
}): TransactionInstruction {
  const [global] = globalConfigPda(params.programId)
  const [vault] = vaultTokenPda(global, params.programId)
  const [userStake] = userStakePda(params.user, params.programId)
  const data = ixData('stake', { amount: params.amount })
  return new TransactionInstruction({
    programId: params.programId,
    keys: keys(
      { pubkey: params.user, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: params.owlMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.userOwlAta, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ),
    data,
  })
}

export function buildUnstakeInstruction(params: {
  programId: PublicKey
  user: PublicKey
  owlMint: PublicKey
  userOwlAta: PublicKey
  amount: BN
}): TransactionInstruction {
  const [global] = globalConfigPda(params.programId)
  const [vault] = vaultTokenPda(global, params.programId)
  const [userStake] = userStakePda(params.user, params.programId)
  const data = ixData('unstake', { amount: params.amount })
  return new TransactionInstruction({
    programId: params.programId,
    keys: keys(
      { pubkey: params.user, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: params.owlMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: params.userOwlAta, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ),
    data,
  })
}

export function buildCreateProposalInstruction(params: {
  programId: PublicKey
  proposer: PublicKey
  owlMint: PublicKey
  proposalId: bigint
  title: string
  votingDurationSecs: BN
}): TransactionInstruction {
  const [global] = globalConfigPda(params.programId)
  const [userStake] = userStakePda(params.proposer, params.programId)
  const [proposal] = proposalPda(global, params.proposalId, params.programId)
  const data = ixData('create_proposal', {
    title: params.title,
    voting_duration_secs: params.votingDurationSecs,
  })
  return new TransactionInstruction({
    programId: params.programId,
    keys: keys(
      { pubkey: params.proposer, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: params.owlMint, isSigner: false, isWritable: false },
      { pubkey: userStake, isSigner: false, isWritable: false },
      { pubkey: proposal, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ),
    data,
  })
}

/** `side`: 0 = Yes, 1 = No (matches on-chain `VoteSide`). */
export function buildCastVoteInstruction(params: {
  programId: PublicKey
  voter: PublicKey
  owlMint: PublicKey
  proposal: PublicKey
  side: 0 | 1
}): TransactionInstruction {
  const [global] = globalConfigPda(params.programId)
  const [userStake] = userStakePda(params.voter, params.programId)
  const [voteReceipt] = voteReceiptPda(params.proposal, params.voter, params.programId)
  const data = ixData('cast_vote', { side: params.side })
  return new TransactionInstruction({
    programId: params.programId,
    keys: keys(
      { pubkey: params.voter, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: params.owlMint, isSigner: false, isWritable: false },
      { pubkey: params.proposal, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: false },
      { pubkey: voteReceipt, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ),
    data,
  })
}

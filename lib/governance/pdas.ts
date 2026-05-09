import { PublicKey } from '@solana/web3.js'

export function globalConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('global')], programId)
}

export function vaultTokenPda(global: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), global.toBuffer()], programId)
}

export function userStakePda(user: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('stake'), user.toBuffer()], programId)
}

export function proposalPda(global: PublicKey, proposalId: bigint, programId: PublicKey): [PublicKey, number] {
  const idBuf = Buffer.allocUnsafe(8)
  idBuf.writeBigUInt64LE(proposalId, 0)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proposal'), global.toBuffer(), idBuf],
    programId
  )
}

export function voteReceiptPda(proposal: PublicKey, voter: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vote'), proposal.toBuffer(), voter.toBuffer()],
    programId
  )
}

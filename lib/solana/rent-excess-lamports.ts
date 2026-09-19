import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'

export type RentExcessAccountRow = {
  address: string
  ownerProgram: string
  dataLen: number
  balanceLamports: bigint
  minRentLamports: bigint
  excessLamports: bigint
  reclaimKind: 'spl_withdraw_excess' | 'system_withdraw_excess' | 'none'
  reclaimNote: string | null
}

export async function fetchMinRentLamports(connection: Connection, dataLength: number): Promise<bigint> {
  return BigInt(await connection.getMinimumBalanceForRentExemption(dataLength))
}

export function computeRentExcess(balanceLamports: bigint, minRentLamports: bigint): bigint {
  if (balanceLamports <= minRentLamports) return 0n
  return balanceLamports - minRentLamports
}

/**
 * Classify whether excess lamports might be reclaimable (platform authority required to execute).
 * Does not inspect on-chain authorities — caller passes `controlledAddresses` set for notes.
 */
export function classifyRentExcessReclaim(
  ownerProgram: PublicKey,
  dataLen: number,
  excessLamports: bigint,
  address: string,
  controlledAddresses: ReadonlySet<string>
): Pick<RentExcessAccountRow, 'reclaimKind' | 'reclaimNote'> {
  if (excessLamports <= 0n) {
    return { reclaimKind: 'none', reclaimNote: null }
  }

  const controlled = controlledAddresses.has(address)

  if (ownerProgram.equals(TOKEN_PROGRAM_ID) || ownerProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    if (!controlled) {
      return {
        reclaimKind: 'none',
        reclaimNote: 'SPL mint/token account — excess may exist but address is not in the controlled set',
      }
    }
    return {
      reclaimKind: 'spl_withdraw_excess',
      reclaimNote: 'Use SPL Token WithdrawExcessLamports (mint authority or token owner)',
    }
  }

  if (ownerProgram.equals(SystemProgram.programId) && dataLen === 0) {
    return {
      reclaimKind: 'none',
      reclaimNote: 'System wallet — balance is spendable SOL, not locked rent excess',
    }
  }

  if (controlled) {
    return {
      reclaimKind: 'system_withdraw_excess',
      reclaimNote: 'Program-owned account — withdraw excess only if your wallet is the designated authority',
    }
  }

  return { reclaimKind: 'none', reclaimNote: 'Excess lamports observed — verify update authority before reclaim' }
}

export async function auditAccountRentExcess(
  connection: Connection,
  address: string,
  controlledAddresses: ReadonlySet<string>,
  accountInfo?: AccountInfo<Buffer> | null
): Promise<RentExcessAccountRow | null> {
  let info = accountInfo
  if (!info) {
    info = await connection.getAccountInfo(new PublicKey(address), 'confirmed')
  }
  if (!info) return null

  const minRent = await fetchMinRentLamports(connection, info.data.length)
  const balance = BigInt(info.lamports)
  const excess = computeRentExcess(balance, minRent)
  const reclaim = classifyRentExcessReclaim(
    info.owner,
    info.data.length,
    excess,
    address,
    controlledAddresses
  )

  return {
    address,
    ownerProgram: info.owner.toBase58(),
    dataLen: info.data.length,
    balanceLamports: balance,
    minRentLamports: minRent,
    excessLamports: excess,
    ...reclaim,
  }
}

/**
 * SPL Token / Token-2022 instruction 38 — WithdrawExcessLamports (SIMD-0437 reclaim path).
 * Authority must be mint authority (mint account) or owner (token account).
 */
export function createSplWithdrawExcessLamportsInstruction(params: {
  source: PublicKey
  destination: PublicKey
  authority: PublicKey
  tokenProgramId?: PublicKey
}): TransactionInstruction {
  const programId = params.tokenProgramId ?? TOKEN_PROGRAM_ID
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: params.source, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([38]),
  })
}

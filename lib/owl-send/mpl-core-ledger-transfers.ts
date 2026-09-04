/**
 * Parse Metaplex Core (MPL Core) TransferV1 instructions from a confirmed tx.
 * Core assets are not SPL tokens — they never appear in pre/postTokenBalances.
 * OwlSend ledger verification must match these ixs when recording Core NFT sends.
 *
 * TransferV1 account layout (mpl-core):
 *   0 asset (writable)
 *   1 collection (optional — program id placeholder when absent)
 *   2 payer (writable, signer)
 *   3 authority (optional signer — program id placeholder when absent)
 *   4 new_owner
 *   5 system_program (optional)
 *   6 log_wrapper (optional)
 *
 * Discriminator: first data byte === 14
 * Program: CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
 */
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

export const MPL_CORE_PROGRAM_ID = new PublicKey(
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
)

/** mpl-core TransferV1 instruction discriminator (u8). */
export const MPL_CORE_TRANSFER_V1_DISCRIMINATOR = 14

export type MplCoreTransferV1Match = {
  asset: string
  newOwner: string
  payer: string
  /** Authority account when present (not the Core program id placeholder). */
  authority: string | null
}

type IxLike = {
  programIdIndex?: number
  accounts?: number[] | Uint8Array
  accountKeyIndexes?: number[]
  data?: string | Uint8Array | number[]
}

type MessageLike = {
  instructions?: IxLike[]
  compiledInstructions?: IxLike[]
}

type MetaLike = {
  innerInstructions?: Array<{
    instructions?: IxLike[]
  }> | null
}

export type MplCoreLedgerTxShape = {
  transaction: { message: unknown }
  meta?: MetaLike | null
}

function instructionDataToBytes(
  data: string | Uint8Array | number[] | undefined
): Uint8Array | null {
  if (data == null) return null
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) {
    try {
      return Uint8Array.from(data)
    } catch {
      return null
    }
  }
  if (typeof data === 'string') {
    if (!data) return null
    try {
      return bs58.decode(data)
    } catch {
      try {
        return Uint8Array.from(Buffer.from(data, 'base64'))
      } catch {
        return null
      }
    }
  }
  return null
}

function ixAccountIndexes(ix: IxLike): number[] {
  if (Array.isArray(ix.accountKeyIndexes) && ix.accountKeyIndexes.length > 0) {
    return ix.accountKeyIndexes
  }
  if (ix.accounts instanceof Uint8Array) {
    return Array.from(ix.accounts)
  }
  if (Array.isArray(ix.accounts) && ix.accounts.length > 0) {
    return ix.accounts
  }
  return []
}

function collectInstructions(tx: MplCoreLedgerTxShape): IxLike[] {
  const msg = tx.transaction.message as MessageLike
  const outer = msg?.instructions?.length
    ? msg.instructions
    : msg?.compiledInstructions?.length
      ? msg.compiledInstructions
      : []
  const all: IxLike[] = [...outer]
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) {
      all.push(ix)
    }
  }
  return all
}

/**
 * Extract every MPL Core TransferV1 (asset → newOwner) from a confirmed transaction.
 * `accountKeys` must be the full key list (static + ALT loaded), matching ix indexes.
 */
export function collectMplCoreTransferV1FromTx(
  tx: MplCoreLedgerTxShape,
  accountKeys: PublicKey[]
): MplCoreTransferV1Match[] {
  const coreId = MPL_CORE_PROGRAM_ID.toBase58()
  const out: MplCoreTransferV1Match[] = []

  for (const ix of collectInstructions(tx)) {
    const programIdIndex = ix.programIdIndex ?? -1
    const programPk = accountKeys[programIdIndex]
    if (!programPk || programPk.toBase58() !== coreId) continue

    const bytes = instructionDataToBytes(ix.data)
    if (!bytes || bytes.length < 1 || bytes[0] !== MPL_CORE_TRANSFER_V1_DISCRIMINATOR) {
      continue
    }

    const indexes = ixAccountIndexes(ix)
    // Need at least asset, collection slot, payer, authority slot, new_owner
    if (indexes.length < 5) continue

    const assetPk = accountKeys[indexes[0]!]
    const payerPk = accountKeys[indexes[2]!]
    const authorityPk = accountKeys[indexes[3]!]
    const newOwnerPk = accountKeys[indexes[4]!]
    if (!assetPk || !payerPk || !newOwnerPk) continue

    const authorityStr = authorityPk ? authorityPk.toBase58() : null
    out.push({
      asset: assetPk.toBase58(),
      newOwner: newOwnerPk.toBase58(),
      payer: payerPk.toBase58(),
      authority:
        authorityStr && authorityStr !== coreId ? authorityStr : null,
    })
  }

  return out
}

/** True when this Core TransferV1 pair covers the claimed ledger line. */
export function mplCoreTransferCoversLedgerLine(
  transfers: MplCoreTransferV1Match[],
  params: { mint: string; recipient: string; fromWallet?: string }
): boolean {
  const mint = params.mint.trim()
  const recipient = params.recipient.trim()
  const from = params.fromWallet?.trim()
  return transfers.some((t) => {
    if (t.asset !== mint || t.newOwner !== recipient) return false
    if (!from) return true
    // Fee payer was already checked at the tx level; also accept payer/authority match.
    return t.payer === from || t.authority === from
  })
}

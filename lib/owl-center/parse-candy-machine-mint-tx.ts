import type { ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import bs58 from 'bs58'

import { collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/** MPL Core program — Core NFTs are accounts owned by this program, not SPL mints. */
const CORE_PROGRAM_B58 = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
/** mpl-core CreateV1 discriminator (first byte). */
const MPL_CORE_CREATE_V1 = 0

function feePayerFromParsed(parsed: ParsedTransactionWithMeta): string | null {
  const key = parsed.transaction.message.accountKeys[0]
  if (!key) return null
  if (key instanceof PublicKey) return key.toBase58()
  if (typeof key === 'object' && 'pubkey' in key) {
    const pk = (key as { pubkey: PublicKey | string }).pubkey
    if (pk instanceof PublicKey) return pk.toBase58()
    if (typeof pk === 'string') return normalizeSolanaWalletAddress(pk)
  }
  return null
}

function candyMachineInTx(parsed: ParsedTransactionWithMeta, candyMachineId: string): boolean {
  let cmPk: PublicKey
  try {
    cmPk = new PublicKey(candyMachineId.trim())
  } catch {
    return false
  }
  return collectParsedTransactionAccountKeys(parsed).some((k) => k.equals(cmPk))
}

function forEachInstruction(
  parsed: ParsedTransactionWithMeta,
  visit: (ix: ParsedInstruction | PartiallyDecodedInstruction) => void
) {
  const outer = parsed.transaction.message.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]
  for (const ix of outer) visit(ix)
  for (const group of parsed.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as (ParsedInstruction | PartiallyDecodedInstruction)[]) {
      visit(ix)
    }
  }
}

/**
 * Core assets created in a tx (system `createAccount` owned by MPL Core).
 * Core NFTs never appear in pre/postTokenBalances.
 */
export function collectCoreAssetsCreatedInTx(parsed: ParsedTransactionWithMeta): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (asset: string) => {
    const v = asset.trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  }

  forEachInstruction(parsed, (ix) => {
    if ('parsed' in ix && ix.parsed && typeof ix.parsed === 'object') {
      const programId = 'programId' in ix ? ix.programId : null
      if (programId && !programId.equals(SystemProgram.programId)) return
      const p = ix.parsed as { type?: string; info?: { newAccount?: string; owner?: string } }
      if (p.type !== 'createAccount' && p.type !== 'createAccountWithSeed') return
      if (p.info?.owner !== CORE_PROGRAM_B58) return
      if (typeof p.info.newAccount === 'string') add(p.info.newAccount)
      return
    }

    const pid = 'programId' in ix ? ix.programId : null
    if (!pid || pid.toBase58() !== CORE_PROGRAM_B58) return
    const raw = (ix as PartiallyDecodedInstruction).data
    if (typeof raw !== 'string' || !raw) return
    let bytes: Uint8Array
    try {
      bytes = bs58.decode(raw)
    } catch {
      return
    }
    if (bytes.length < 1 || bytes[0] !== MPL_CORE_CREATE_V1) return
    const accounts = (ix as PartiallyDecodedInstruction).accounts ?? []
    const assetPk = accounts[0]
    if (assetPk instanceof PublicKey) add(assetPk.toBase58())
    else if (typeof assetPk === 'string') add(assetPk)
  })
  return out
}

function parseCoreCandyMachineMintFromTransaction(
  parsed: ParsedTransactionWithMeta,
  candyMachineId: string
): { wallet: string; mintedNftMints: string[]; quantity: number } | null {
  if (parsed.meta?.err) return null

  const mintedNftMints = collectCoreAssetsCreatedInTx(parsed)
  if (mintedNftMints.length === 0) return null
  if (!candyMachineInTx(parsed, candyMachineId)) return null

  const wallet = feePayerFromParsed(parsed)
  if (!wallet) return null

  return { wallet, mintedNftMints, quantity: mintedNftMints.length }
}

function parseTmCandyMachineMintFromTransaction(
  parsed: ParsedTransactionWithMeta,
  candyMachineId: string
): { wallet: string; mintedNftMints: string[]; quantity: number } | null {
  if (parsed.meta?.err) return null

  const logs = parsed.meta?.logMessages ?? []
  if (!logs.some((line) => line.includes('Instruction: MintV2'))) return null
  if (!candyMachineInTx(parsed, candyMachineId)) return null

  const wallet = feePayerFromParsed(parsed)
  if (!wallet) return null

  const preOwned = new Set<string>()
  for (const bal of parsed.meta?.preTokenBalances ?? []) {
    if (bal.owner === wallet && bal.mint) preOwned.add(bal.mint)
  }

  const mintedNftMints: string[] = []
  for (const bal of parsed.meta?.postTokenBalances ?? []) {
    if (bal.owner !== wallet || !bal.mint) continue
    if (bal.uiTokenAmount?.amount !== '1') continue
    if (!preOwned.has(bal.mint)) mintedNftMints.push(bal.mint)
  }

  if (mintedNftMints.length === 0) {
    for (const bal of parsed.meta?.postTokenBalances ?? []) {
      if (bal.owner === wallet && bal.mint && bal.uiTokenAmount?.amount === '1') {
        mintedNftMints.push(bal.mint)
      }
    }
  }

  if (mintedNftMints.length === 0) return null

  return { wallet, mintedNftMints, quantity: mintedNftMints.length }
}

/** Parse a successful Candy Machine mint (Core mintV1 or Token Metadata mintV2) for reconciliation. */
export function parseCandyMachineMintFromTransaction(
  parsed: ParsedTransactionWithMeta,
  candyMachineId: string
): { wallet: string; mintedNftMints: string[]; quantity: number } | null {
  return (
    parseCoreCandyMachineMintFromTransaction(parsed, candyMachineId) ??
    parseTmCandyMachineMintFromTransaction(parsed, candyMachineId)
  )
}

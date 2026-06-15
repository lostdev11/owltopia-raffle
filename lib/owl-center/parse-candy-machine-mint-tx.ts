import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import { collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

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

/** Parse a successful Candy Machine mintV2 transaction for reconciliation. */
export function parseCandyMachineMintFromTransaction(
  parsed: ParsedTransactionWithMeta,
  candyMachineId: string
): { wallet: string; mintedNftMints: string[]; quantity: number } | null {
  if (parsed.meta?.err) return null

  const logs = parsed.meta?.logMessages ?? []
  if (!logs.some((line) => line.includes('Instruction: MintV2'))) return null

  let cmPk: PublicKey
  try {
    cmPk = new PublicKey(candyMachineId.trim())
  } catch {
    return null
  }
  const keys = collectParsedTransactionAccountKeys(parsed)
  if (!keys.some((k) => k.equals(cmPk))) return null

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

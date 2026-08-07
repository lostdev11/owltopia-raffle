/**
 * Transfer-lock checks for raffle create / prize deposit / wallet picker badges.
 *
 * Programmable NFTs (pNFTs) often show SPL token-account `state=frozen` as part of
 * Token Metadata rule-set mechanics even when the owner can still transfer via
 * Metaplex Token Metadata (Magic Eden, Tensor, Sharky, etc.). A true stake/nest
 * lock on a pNFT requires BOTH frozen and a lock delegate.
 *
 * Classic SPL NFTs: `frozen` alone means nested / mint-locked.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

/** Helius DAS / WalletNft.interface values that mean Metaplex programmable NFT. */
export function isProgrammableNftInterface(iface: string | null | undefined): boolean {
  const v = (iface ?? '').trim().toLowerCase()
  if (!v) return false
  return v === 'programmablenft' || v.includes('programmable')
}

/**
 * Whether an SPL token account is locked against owner transfer for raffle purposes.
 *
 * @param programmableNft — when true, frozen alone is not a lock (need delegate too).
 */
export function isSplNftTransferLocked(params: {
  frozen: boolean
  delegated: boolean
  programmableNft?: boolean
}): boolean {
  if (!params.frozen) return false
  if (params.programmableNft) return params.delegated
  return true
}

/** Picker / DAS row: treat pNFT freeze-without-delegate as transferable. */
export function isWalletNftTransferLocked(
  nft: Pick<WalletNft, 'frozen' | 'delegated' | 'interface'>
): boolean {
  return isSplNftTransferLocked({
    frozen: nft.frozen === true,
    delegated: nft.delegated === true,
    programmableNft: isProgrammableNftInterface(nft.interface),
  })
}

/**
 * True when the Token Record PDA exists for this mint + token account
 * (initialized programmable NFT hold).
 */
export async function tokenRecordAccountExists(
  connection: Connection,
  mint: PublicKey,
  tokenAccount: PublicKey,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<boolean> {
  const [tokenRecord] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from('token_record'),
      tokenAccount.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  )
  try {
    const info = await connection.getAccountInfo(tokenRecord, commitment)
    return Boolean(info?.data && info.data.length > 0)
  } catch {
    return false
  }
}

export type NftHolderLockFields = {
  isFrozen?: boolean
  hasDelegate?: boolean
  tokenAccount: PublicKey
}

/**
 * Async lock check for getNftHolderInWallet results.
 * Frozen + delegate → locked. Frozen without delegate → locked only if not a pNFT.
 */
export async function isNftHolderTransferLocked(params: {
  connection: Connection
  mint: PublicKey
  holder: NftHolderLockFields
  /** DAS/UI hint — skips Token Record RPC when true/false. */
  programmableNftHint?: boolean | null
  commitment?: 'processed' | 'confirmed' | 'finalized'
}): Promise<boolean> {
  const frozen = params.holder.isFrozen === true
  const delegated = params.holder.hasDelegate === true
  if (!frozen) return false
  if (delegated) return true

  if (params.programmableNftHint === true) return false
  if (params.programmableNftHint === false) {
    return isSplNftTransferLocked({ frozen: true, delegated: false, programmableNft: false })
  }

  const isPnft = await tokenRecordAccountExists(
    params.connection,
    params.mint,
    params.holder.tokenAccount,
    params.commitment ?? 'confirmed'
  )
  return isSplNftTransferLocked({
    frozen: true,
    delegated: false,
    programmableNft: isPnft,
  })
}

/** User-facing copy when a true nest/stake lock blocks raffle create or deposit. */
export const NFT_TRANSFER_LOCKED_RAFFLE_MESSAGE =
  'This NFT is frozen on-chain (nested or mint-locked). Unnest/thaw it before creating a raffle. A leftover Gen2 stake delegate alone is fine. Programmable NFTs (pNFTs) that only show frozen without a lock delegate are transferable.'

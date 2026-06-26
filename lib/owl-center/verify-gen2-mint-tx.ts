import bs58 from 'bs58'
import { Connection, PublicKey } from '@solana/web3.js'

import {
  fetchParsedTransactionWithPoll,
  feePayerMatchesBuyer,
  collectParsedTransactionAccountKeys,
} from '@/lib/gen2-presale/verify-payment'
import {
  owlCenterPlatformMintFeeVerifyBand,
  owlCenterPlatformMintFeeVerifyFallbackBand,
  resolveOwlCenterPlatformMintFeeLamports,
  verifyOwlCenterPlatformMintFeeSol,
} from '@/lib/solana/owl-center-platform-mint-fee'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveOwlCenterMintVerifyRpcUrl, type OwlMintNetwork } from '@/lib/solana/network'
import { pollTransactionSignatureStatus } from '@/lib/solana/recover-candy-machine-mint'

export type VerifyGen2MintTxResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'failed'
        | 'fee_payer_mismatch'
        | 'candy_machine_missing'
        | 'platform_fee_missing'
        | 'no_nft_minted'
        | 'wrong_guard_group'
    }

// Candy Guard program + `mintV2` Anchor discriminator (mirrors lib/solana/gen2-guards.ts and the
// cosign route). Used to bind a confirmed mint tx to the guard group of the claimed phase, so a
// wallet cannot mint cheaply in one group on-chain and then record the mint under a different
// (cheaper / more permissive) phase once multiple phases are live concurrently.
const CANDY_GUARD_PROGRAM_ID = 'Guard1JwRhJkVH6XZhzoYxeBVQe872VH6QggF4BWmS9g'
const MINT_V2_DISCRIMINATOR = [120, 121, 23, 146, 173, 110, 199, 205] as const

/** `mintV2` group field is the LAST field: `Some` = 0x01 + u32le(len) + utf8. */
function expectedGroupTail(label: string): Uint8Array {
  const utf8 = new TextEncoder().encode(label)
  const out = new Uint8Array(1 + 4 + utf8.length)
  out[0] = 1
  new DataView(out.buffer).setUint32(1, utf8.length, true)
  out.set(utf8, 5)
  return out
}

function dataStartsWith(data: Uint8Array, prefix: ReadonlyArray<number>): boolean {
  if (data.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false
  return true
}

function dataEndsWith(data: Uint8Array, tail: Uint8Array): boolean {
  if (data.length < tail.length) return false
  const start = data.length - tail.length
  for (let i = 0; i < tail.length; i++) if (data[start + i] !== tail[i]) return false
  return true
}

/**
 * Require that the confirmed tx contains a Candy Guard `mintV2` for the EXPECTED guard group.
 * Returns false only when mintV2 candy-guard instructions are present but NONE use the expected
 * group (a clear cross-group attempt). If no decodable mintV2 is found (parsing edge case), we do
 * not block — the candy-machine-presence + NFT-minted checks and the cosign group binding (free
 * phases) still apply — but we log it.
 */
function mintTxMatchesGuardGroup(
  parsed: { transaction: { message: { instructions?: unknown[] } } },
  expectedLabel: string
): boolean {
  const tail = expectedGroupTail(expectedLabel)
  const instructions = parsed.transaction.message.instructions ?? []
  let mintV2Count = 0
  let matched = 0
  for (const ixRaw of instructions) {
    const ix = ixRaw as { programId?: { toBase58?: () => string }; data?: unknown }
    const pid = ix.programId?.toBase58?.()
    if (pid !== CANDY_GUARD_PROGRAM_ID || typeof ix.data !== 'string') continue
    let bytes: Uint8Array
    try {
      bytes = bs58.decode(ix.data)
    } catch {
      continue
    }
    if (!dataStartsWith(bytes, MINT_V2_DISCRIMINATOR)) continue
    mintV2Count++
    if (dataEndsWith(bytes, tail)) matched++
  }
  if (mintV2Count > 0 && matched === 0) return false
  if (mintV2Count === 0) {
    console.warn('[verify-gen2-mint-tx] no decodable mintV2 instruction found for guard-group binding')
  }
  return true
}

/**
 * Decode which candy-guard group a confirmed tx's `mintV2` targeted (e.g. `gen1`/`pre`/`wl`/`pub`).
 * Returns the FIRST candidate label whose encoded `Some(group)` tail matches a mintV2 instruction,
 * or null when none match / no decodable mintV2 is present. Used by reconciliation to attribute an
 * orphaned on-chain mint to the correct phase (the group it actually used), independent of which
 * phase is live now.
 */
export function detectGen2MintV2GroupLabel(
  parsed: { transaction: { message: { instructions?: unknown[] } } },
  candidateLabels: readonly string[]
): string | null {
  const instructions = parsed.transaction.message.instructions ?? []
  for (const ixRaw of instructions) {
    const ix = ixRaw as { programId?: { toBase58?: () => string }; data?: unknown }
    if (ix.programId?.toBase58?.() !== CANDY_GUARD_PROGRAM_ID || typeof ix.data !== 'string') continue
    let bytes: Uint8Array
    try {
      bytes = bs58.decode(ix.data)
    } catch {
      continue
    }
    if (!dataStartsWith(bytes, MINT_V2_DISCRIMINATOR)) continue
    for (const label of candidateLabels) {
      if (dataEndsWith(bytes, expectedGroupTail(label))) return label
    }
  }
  return null
}

type ParsedTokenBalance = {
  accountIndex: number
  owner?: string | null
  uiTokenAmount?: { amount?: string | null; decimals?: number | null }
}

/**
 * Count NFTs (decimals 0, amount 1) that became owned by `wallet` in this tx — i.e. token accounts
 * that hold 1 unit AFTER the tx but did not before. A successful Candy Machine `mintV2` creates
 * exactly such an account; a bot-tax tx (failed guard) creates none, so this returns 0 and lets the
 * caller reject "successful" txs that minted nothing.
 */
function countNftsMintedToWallet(
  parsed: { meta?: { postTokenBalances?: ParsedTokenBalance[] | null; preTokenBalances?: ParsedTokenBalance[] | null } | null },
  walletNorm: string
): number {
  const post = parsed.meta?.postTokenBalances ?? []
  const pre = parsed.meta?.preTokenBalances ?? []
  const preAmountByAccount = new Map<number, string>()
  for (const b of pre) preAmountByAccount.set(b.accountIndex, b.uiTokenAmount?.amount ?? '0')

  let count = 0
  for (const b of post) {
    const owner = b.owner ? normalizeSolanaWalletAddress(b.owner) : null
    if (owner !== walletNorm) continue
    if ((b.uiTokenAmount?.decimals ?? -1) !== 0) continue
    if ((b.uiTokenAmount?.amount ?? '0') !== '1') continue
    // Only count balances that newly became 1 (skip NFTs the wallet already held pre-tx).
    if ((preAmountByAccount.get(b.accountIndex) ?? '0') === '1') continue
    count++
  }
  return count
}

/**
 * Confirms the signature exists, succeeded, and fee payer matches minter.
 * Optionally ensures the configured Candy Machine pubkey appears in loaded account keys.
 *
 * TODO: Devnet CM smoke tests; strict ix decode (mintV2) + guard group; Helius enhanced txs.
 * TODO: Parse minted NFT mint addresses from inner instructions for reconciliation.
 */
export async function verifyGen2MintTransaction(params: {
  txSignature: string
  wallet: string
  candyMachineId?: string | null
  /** When set, selects RPC (devnet vs mainnet verification). */
  network?: OwlMintNetwork
  /** When true, require SOL platform fee credit to OWL_PLATFORM_FEE_TREASURY_WALLET in the same tx. */
  requirePlatformMintFee?: boolean
  /** Number of NFTs minted in this tx — scales expected platform fee when batched. */
  mintQuantity?: number
  /**
   * Minimum NFTs the tx must actually mint to the wallet (default 1). Rejects bot-tax txs that
   * "succeed" on-chain but mint nothing (the candy guard taxes instead of failing the tx).
   */
  minMintedNfts?: number
  /**
   * On-chain candy-guard group label expected for the claimed phase (e.g. `gen1`/`pre`/`wl`/`pub`).
   * When set, the tx's `mintV2` must target this group — binds the recorded phase to the group that
   * actually minted so concurrent phases can't be cross-recorded. Null/undefined skips the check.
   */
  expectedGuardGroupLabel?: string | null
}): Promise<VerifyGen2MintTxResult> {
  const net = params.network ?? 'mainnet'
  const rpcUrl = resolveOwlCenterMintVerifyRpcUrl(net)
  const connection = new Connection(rpcUrl, 'confirmed')
  await pollTransactionSignatureStatus(rpcUrl, params.txSignature, {
    maxWaitMs: 5000,
    intervalMs: 200,
    minCommitment: 'processed',
  })
  const parsed = await fetchParsedTransactionWithPoll(connection, params.txSignature, {
    maxWaitMs: 3000,
    intervalMs: 200,
  })
  if (!parsed) return { ok: false, reason: 'not_found' }
  if (parsed.meta?.err) return { ok: false, reason: 'failed' }

  const buyer = new PublicKey(normalizeSolanaWalletAddress(params.wallet) ?? params.wallet)
  if (!feePayerMatchesBuyer(parsed, buyer)) {
    return { ok: false, reason: 'fee_payer_mismatch' }
  }

  const cm = params.candyMachineId?.trim()
  if (cm) {
    try {
      const cmPk = new PublicKey(cm)
      const flat = collectParsedTransactionAccountKeys(parsed)
      const hit = flat.some((k) => k.equals(cmPk))
      if (!hit) {
        return { ok: false, reason: 'candy_machine_missing' }
      }
    } catch {
      return { ok: false, reason: 'candy_machine_missing' }
    }
  }

  const expectedGroup = params.expectedGuardGroupLabel?.trim()
  if (expectedGroup && !mintTxMatchesGuardGroup(parsed, expectedGroup)) {
    return { ok: false, reason: 'wrong_guard_group' }
  }

  // A bot-tax tx references the Candy Machine and "succeeds" (no meta.err) but mints no NFT — the
  // candy guard charges the bot tax instead of failing. Require a real NFT to land on the wallet so
  // these can never be recorded as mints (which would inflate supply with phantom owls).
  const minMinted = Math.max(1, Math.floor(params.minMintedNfts ?? 1))
  const walletNorm = normalizeSolanaWalletAddress(params.wallet) ?? params.wallet
  if (countNftsMintedToWallet(parsed, walletNorm) < minMinted) {
    return { ok: false, reason: 'no_nft_minted' }
  }

  if (params.requirePlatformMintFee) {
    const mintQty = Math.max(1, Math.floor(params.mintQuantity ?? 1))
    const feeQuote = await resolveOwlCenterPlatformMintFeeLamports()
    const band = feeQuote.ok
      ? owlCenterPlatformMintFeeVerifyBand(feeQuote.lamports * BigInt(mintQty))
      : owlCenterPlatformMintFeeVerifyFallbackBand(mintQty)
    const feeCheck = verifyOwlCenterPlatformMintFeeSol({
      parsed,
      minLamports: band.minLamports,
      maxLamports: band.maxLamports,
    })
    if (!feeCheck.ok) {
      return { ok: false, reason: 'platform_fee_missing' }
    }
  }

  return { ok: true }
}

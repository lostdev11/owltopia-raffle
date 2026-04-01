/**
 * Prize escrow: platform-held NFT until settlement, then automatic transfer to winner.
 * Requires PRIZE_ESCROW_SECRET_KEY (JSON array of 64 bytes, or base58 secret key).
 *
 * Optional PRIZE_NFT_FREEZE_AUTHORITY_SECRET_KEY: same formats. When set, if a prize mint's
 * SPL freeze authority matches this keypair, the server can ThawAccount on the escrow ATA
 * in the same transaction as the transfer. The escrow wallet alone cannot move tokens out
 * of a frozen account; thaw always requires a signature from the mint's freeze authority.
 *
 * Return-to-creator transfers are sent with skipPreflight: true because some RPC nodes
 * can fail simulation ("Attempt to debit") even when getAccount shows balance at
 * commitment 'confirmed'. We still verify balance before building the tx; if the tx
 * is invalid it will fail at confirmTransaction.
 */
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  createThawAccountInstruction,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSolanaConnection } from '@/lib/solana/connection'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createSignerFromKeypair, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import {
  getAssetWithProof,
  getCompressionProgramsForV1Ixs,
  mplBubblegum,
  transfer as bubblegumTransfer,
} from '@metaplex-foundation/mpl-bubblegum'
import { fetchAsset, fetchAssetV1, transferV1 } from '@metaplex-foundation/mpl-core'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Raffle } from '@/lib/types'

const NFT_AMOUNT = 1n

/** SPL Token custom error 0x11 = account frozen; simulation logs often say "Account is frozen". */
function humanizeSplPrizeTransferError(message: string): string {
  const m = message.toLowerCase()
  if (
    m.includes('account is frozen') ||
    m.includes('custom program error: 0x11') ||
    /\b0x11\b/.test(m)
  ) {
    return (
      'Payout is blocked on-chain: Solana will not move tokens while that token account is frozen. ' +
      'Many collections use freeze authority to protect stolen NFTs from being sold; that is normal, but the same rule applies in escrow. ' +
      'Whoever holds the mint freeze authority must thaw the prize escrow token account for this mint, then the winner can claim. ' +
      'Ask the collection or support for a thaw of that specific escrow account. On mobile, wait for one attempt to finish before retrying.'
    )
  }
  return message
}

function parseSolanaSecretKeyFromEnv(raw: string | undefined): Keypair | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as number[]
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    const bs58 = require('bs58')
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

function parseEscrowKeypair(): Keypair | null {
  return parseSolanaSecretKeyFromEnv(process.env.PRIZE_ESCROW_SECRET_KEY)
}


let escrowKeypairCache: Keypair | null | undefined = undefined

/** Returns the prize escrow keypair if PRIZE_ESCROW_SECRET_KEY is set. */
export function getPrizeEscrowKeypair(): Keypair | null {
  if (escrowKeypairCache !== undefined) return escrowKeypairCache
  escrowKeypairCache = parseEscrowKeypair()
  return escrowKeypairCache
}

/** Returns the prize escrow public key (for showing deposit address). */
export function getPrizeEscrowPublicKey(): string | null {
  const kp = getPrizeEscrowKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

let nftFreezeAuthorityCache: Keypair | null | undefined = undefined

/**
 * Optional SPL mint freeze authority keypair (server-only).
 * When it matches mint.freezeAuthority, claim/return txs can ThawAccount then Transfer.
 */
function getOptionalNftFreezeAuthorityKeypair(): Keypair | null {
  if (nftFreezeAuthorityCache !== undefined) return nftFreezeAuthorityCache
  nftFreezeAuthorityCache = parseSolanaSecretKeyFromEnv(
    process.env.PRIZE_NFT_FREEZE_AUTHORITY_SECRET_KEY
  )
  return nftFreezeAuthorityCache
}

/**
 * When PRIZE_NFT_FREEZE_AUTHORITY_SECRET_KEY is set, returns that keypair's public key so ops can
 * confirm it matches mint.freezeAuthority on Solscan (claim txs use ThawAccount + Transfer).
 */
export function getPrizeNftFreezeAuthorityPublicKey(): string | null {
  const kp = getOptionalNftFreezeAuthorityKeypair()
  return kp ? kp.publicKey.toBase58() : null
}

/**
 * If escrow source ATA is frozen, returns who must sign ThawAccount (always the mint freeze authority).
 * When not frozen, thawSigner is null.
 */
async function resolveThawSignerIfEscrowSourceFrozen(
  connection: Connection,
  mint: PublicKey,
  sourceIsFrozen: boolean,
  tokenProgram: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID,
  escrowKeypair: Keypair
): Promise<
  { ok: true; thawSigner: Keypair | null } | { ok: false; error: string }
> {
  if (!sourceIsFrozen) return { ok: true, thawSigner: null }
  const mintInfo = await getMint(connection, mint, 'confirmed', tokenProgram)
  const freezeAuthority = mintInfo.freezeAuthority
  if (!freezeAuthority) {
    return { ok: false, error: humanizeSplPrizeTransferError('Account is frozen') }
  }
  if (freezeAuthority.equals(escrowKeypair.publicKey)) {
    return { ok: true, thawSigner: escrowKeypair }
  }
  const freezeKp = getOptionalNftFreezeAuthorityKeypair()
  if (freezeKp && freezeAuthority.equals(freezeKp.publicKey)) {
    return { ok: true, thawSigner: freezeKp }
  }
  return { ok: false, error: humanizeSplPrizeTransferError('Account is frozen') }
}

function collectTxSigners(escrowKeypair: Keypair, thawSigner: Keypair | null): Keypair[] {
  if (!thawSigner || thawSigner.publicKey.equals(escrowKeypair.publicKey)) {
    return [escrowKeypair]
  }
  return [escrowKeypair, thawSigner]
}

/** Token program ID type for SPL vs Token-2022 */
const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

/**
 * Determine which token program the escrow uses for this mint (SPL Token or Token-2022).
 * Tries standard SPL first, then Token-2022. Recognizes any NFT type for return/transfer flows.
 */
async function getEscrowTokenProgramForMint(
  mint: PublicKey,
  escrowOwner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const connection = getSolanaConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        escrowOwner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount >= NFT_AMOUNT) return programId
    } catch {
      // no account or wrong program, try next
    }
  }
  return null
}

/**
 * Get the escrow's token account address for a given mint (SPL Token or Token-2022).
 * Used for explorer links and any flow that needs to reference the escrow token account.
 * Returns null if escrow is not configured or does not hold this NFT.
 */
export async function getEscrowTokenAccountForMint(mint: PublicKey): Promise<PublicKey | null> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) return null
  const connection = getSolanaConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        keypair.publicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const account = await getAccount(connection, ata, 'confirmed', programId)
      if (account.amount >= NFT_AMOUNT) return ata
    } catch {
      // no account or wrong program
    }
  }
  return null
}

const FROZEN_ESCROW_PRIZE_MSG =
  'This prize cannot go live while its token account in escrow is frozen. Solana would not be able to send it to a winner. ' +
  'Collections often freeze accounts for holder safety; the freeze authority still needs to thaw only the escrow token account for this mint when you want this raffle to be claimable, or use a different prize.'

const FROZEN_CREATOR_HOLDING_MSG =
  'This NFT cannot be sent to escrow while its token account in your wallet is frozen. If you froze it for security, thaw when you are ready to deposit, then try again—or pick another prize.'

/**
 * If escrow holds this mint as SPL/Token-2022 with balance ≥ 1, reject when that token account is frozen.
 * No-op when not held as SPL (e.g. not yet deposited, or Core/compressed only).
 */
export async function assertEscrowSplPrizeNotFrozen(
  mint: PublicKey
): Promise<{ blocked: false } | { blocked: true; error: string }> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) return { blocked: false }

  const tokenProgram = await getEscrowTokenProgramForMint(mint, keypair.publicKey)
  if (!tokenProgram) return { blocked: false }

  const connection = getSolanaConnection()
  const ata = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  try {
    const acc = await getAccount(connection, ata, 'confirmed', tokenProgram)
    if (acc.amount < NFT_AMOUNT) return { blocked: false }
    if (acc.isFrozen) {
      const mintInfo = await getMint(connection, mint, 'confirmed', tokenProgram)
      const fa = mintInfo.freezeAuthority
      const freezeKp = getOptionalNftFreezeAuthorityKeypair()
      if (
        fa &&
        (fa.equals(keypair.publicKey) || (freezeKp && fa.equals(freezeKp.publicKey)))
      ) {
        return { blocked: false }
      }
      return { blocked: true, error: FROZEN_ESCROW_PRIZE_MSG }
    }
  } catch {
    return { blocked: false }
  }
  return { blocked: false }
}

/**
 * If the creator wallet holds this mint as SPL/Token-2022 with balance ≥ 1, reject when that token account is frozen.
 * No-op when not holding (e.g. mint not yet acquired).
 */
export async function assertCreatorSplHoldingNotFrozen(
  creatorWallet: PublicKey,
  mint: PublicKey
): Promise<{ blocked: false } | { blocked: true; error: string }> {
  const connection = getSolanaConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        creatorWallet,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const acc = await getAccount(connection, ata, 'confirmed', programId)
      if (acc.amount >= NFT_AMOUNT && acc.isFrozen) {
        return { blocked: true, error: FROZEN_CREATOR_HOLDING_MSG }
      }
    } catch {
      // no account or wrong program
    }
  }
  return { blocked: false }
}

/** One NFT held in escrow: mint address and which token program it uses. */
export type EscrowHeldNft = { mint: string; tokenProgram: PublicKey }

/**
 * List all NFTs the escrow holds (balance >= 1), from both SPL Token and Token-2022.
 * Used to determine which NFT to return based on what was actually deposited.
 */
export async function getEscrowHeldNftMints(): Promise<EscrowHeldNft[]> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) return []
  const connection = getSolanaConnection()
  const results: EscrowHeldNft[] = []
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const res = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, {
        programId,
      })
      for (const { account } of res.value) {
        const info = account?.data?.parsed?.info
        if (!info?.mint) continue
        const amount = info.tokenAmount?.amount
        const amountNum = amount != null ? BigInt(amount) : 0n
        if (amountNum >= NFT_AMOUNT) {
          results.push({ mint: info.mint as string, tokenProgram: programId })
        }
      }
    } catch {
      // skip program on error
    }
  }
  return results
}

/**
 * Check if an Mpl Core asset is owned by the escrow keypair (used for Core NFT prizes).
 */
export async function isMplCoreAssetInEscrow(mint: string): Promise<boolean> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) return false
  const endpoint = resolveServerSolanaRpcUrl()

  // createUmi has multiple overloads; use any to avoid version-specific type issues.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umi: any = (createUmi as any)(endpoint as any)
  const asset: any = await fetchAssetV1(umi, umiPublicKey(mint))
  return asset.owner?.toString() === keypair.publicKey.toBase58()
}

/**
 * Transfer an Mpl Core NFT prize from the platform escrow to the winner.
 * Mirrors SPL / Token-2022 flow but uses Mpl Core's transferV1 with the escrow keypair as signer.
 * Idempotent when nft_transfer_transaction is already set.
 */
export async function transferMplCorePrizeToWinner(raffleId: string): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found' }
  }
  if (
    raffle.prize_type !== 'nft' ||
    !raffle.nft_mint_address ||
    !raffle.winner_wallet
  ) {
    return { ok: false, error: 'Raffle is not an NFT raffle or has no winner' }
  }
  // Only handle Core prizes here; SPL / Token-2022 uses transferNftPrizeToWinner.
  const standard = raffle.prize_standard ?? null
  if (standard !== 'mpl_core') {
    return { ok: false, error: 'Raffle prize is not an Mpl Core asset' }
  }
  if (raffle.nft_transfer_transaction) {
    return { ok: true, signature: raffle.nft_transfer_transaction }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const endpoint = resolveServerSolanaRpcUrl()

  // createUmi has multiple overloads; use any to avoid version-specific type issues.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umi: any = (createUmi as any)(endpoint as any)

  // Convert web3.js Keypair into an Umi signer so the escrow can sign the Core transfer.
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))

  const asset = umiPublicKey(raffle.nft_mint_address)
  const newOwner = umiPublicKey(raffle.winner_wallet)
  // If the Core asset belongs to a collection, transfer must include that account.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetAccount: any = await fetchAsset(umi as any, asset)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = transferV1(umi as any, {
      asset,
      newOwner,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await builder.sendAndConfirm(umi as any)
    const sig = String(result.signature ?? result)

    // Persist winner claim + release lock (best effort; on-chain transfer already succeeded).
    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({
          nft_transfer_transaction: sig,
          nft_claim_locked_at: null,
          nft_claim_locked_wallet: null,
        })
        .eq('id', raffleId)
    } catch (dbErr) {
      console.error(`Failed to persist Core prize transfer for raffle ${raffleId}:`, dbErr)
      // Avoid leaving the raffle stuck in "locked" state.
      try {
        await getSupabaseAdmin()
          .from('raffles')
          .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
          .eq('id', raffleId)
      } catch {
        // swallow - we still return the on-chain signature
      }
    }
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Mpl Core prize transfer failed for raffle ${raffleId}:`, err)
    // Release lock so the winner can retry if the transfer fails.
    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
        .eq('id', raffleId)
    } catch {
      // ignore
    }
    return { ok: false, error: message }
  }
}

/**
 * Transfer a compressed (Bubblegum) NFT from escrow to the winner.
 * Idempotent when nft_transfer_transaction is already set.
 */
export async function transferCompressedPrizeToWinner(raffleId: string): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found' }
  }
  if (raffle.prize_type !== 'nft' || !raffle.winner_wallet) {
    return { ok: false, error: 'Raffle is not an NFT raffle or has no winner' }
  }
  if (raffle.nft_transfer_transaction) {
    return { ok: true, signature: raffle.nft_transfer_transaction }
  }

  const assetId = (raffle.nft_mint_address || raffle.nft_token_id || '').trim()
  if (!assetId) {
    return { ok: false, error: 'Missing compressed NFT asset id' }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const escrowBase58 = keypair.publicKey.toBase58()
  const endpoint = resolveServerSolanaRpcUrl()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())

  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
    const leafOwnerStr = asset?.leafOwner ? String(asset.leafOwner) : ''
    if (leafOwnerStr !== escrowBase58) {
      return {
        ok: false,
        error:
          'Prize compressed NFT is not in escrow under this asset id, or the asset is not compressed.',
      }
    }

    const { compressionProgram, logWrapper } = await getCompressionProgramsForV1Ixs(umi)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = bubblegumTransfer(umi, {
      leafOwner: umiPublicKey(escrowBase58),
      leafDelegate: asset.leafDelegate,
      newLeafOwner: umiPublicKey(raffle.winner_wallet.trim()),
      merkleTree: asset.merkleTree,
      root: asset.root,
      dataHash: asset.dataHash,
      creatorHash: asset.creatorHash,
      nonce: BigInt(asset.nonce),
      index: asset.index,
      proof: asset.proof,
      compressionProgram,
      logWrapper,
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await builder.sendAndConfirm(umi)
    const sig = String(result.signature ?? result)

    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({
          nft_transfer_transaction: sig,
          nft_claim_locked_at: null,
          nft_claim_locked_wallet: null,
        })
        .eq('id', raffleId)
    } catch (dbErr) {
      console.error(`Failed to persist compressed prize transfer for raffle ${raffleId}:`, dbErr)
      try {
        await getSupabaseAdmin()
          .from('raffles')
          .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
          .eq('id', raffleId)
      } catch {
        // swallow
      }
    }
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Compressed prize transfer failed for raffle ${raffleId}:`, err)
    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
        .eq('id', raffleId)
    } catch {
      // ignore
    }
    return { ok: false, error: message }
  }
}

/**
 * Transfer the NFT prize from the platform escrow to the winner.
 * Call after selectWinner for NFT raffles. Idempotent if nft_transfer_transaction already set.
 */
export async function transferNftPrizeToWinner(raffleId: string): Promise<{
  ok: boolean
  signature?: string
  error?: string
}> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found' }
  }
  if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address || !raffle.winner_wallet) {
    return { ok: false, error: 'Raffle is not an NFT raffle or has no winner' }
  }
  if (raffle.nft_transfer_transaction) {
    return { ok: true, signature: raffle.nft_transfer_transaction }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const connection = getSolanaConnection()
  const mint = new PublicKey(raffle.nft_mint_address)
  const winnerPubkey = new PublicKey(raffle.winner_wallet)

  const tokenProgram = await getEscrowTokenProgramForMint(mint, keypair.publicKey)
  if (!tokenProgram) {
    return { ok: false, error: 'Escrow does not hold this NFT (tried SPL Token and Token-2022)' }
  }

  const sourceAta = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const destAta = await getAssociatedTokenAddress(
    mint,
    winnerPubkey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  let sourceTokenAccount
  try {
    sourceTokenAccount = await getAccount(connection, sourceAta, 'confirmed', tokenProgram)
  } catch {
    return {
      ok: false,
      error: 'Could not read the escrow token account for this NFT on-chain.',
    }
  }
  const thawRes = await resolveThawSignerIfEscrowSourceFrozen(
    connection,
    mint,
    sourceTokenAccount.isFrozen,
    tokenProgram,
    keypair
  )
  if (!thawRes.ok) {
    return { ok: false, error: thawRes.error }
  }
  const thawSigner = thawRes.thawSigner

  let destAccountExists = false
  try {
    const destAcc = await getAccount(connection, destAta, 'confirmed', tokenProgram)
    destAccountExists = true
    if (destAcc.isFrozen) {
      return {
        ok: false,
        error:
          'Your wallet already has a token account for this NFT that is frozen, so the prize cannot be sent there. ' +
          'Thaw that account if you can, or contact support.',
      }
    }
  } catch {
    destAccountExists = false
  }

  const tx = new Transaction()
  if (thawSigner) {
    tx.add(
      createThawAccountInstruction(sourceAta, mint, thawSigner.publicKey, [], tokenProgram)
    )
  }
  if (!destAccountExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        destAta,
        winnerPubkey,
        mint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(
    createTransferInstruction(
      sourceAta,
      destAta,
      keypair.publicKey,
      NFT_AMOUNT,
      [],
      tokenProgram
    )
  )

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = keypair.publicKey
    tx.sign(...collectTxSigners(keypair, thawSigner))

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    // Persist winner claim + release lock (best effort; on-chain transfer already succeeded).
    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({
          nft_transfer_transaction: sig,
          nft_claim_locked_at: null,
          nft_claim_locked_wallet: null,
        })
        .eq('id', raffleId)
    } catch (dbErr) {
      console.error(`Failed to persist NFT prize transfer for raffle ${raffleId}:`, dbErr)
      // Avoid leaving the raffle stuck in "locked" state.
      try {
        await getSupabaseAdmin()
          .from('raffles')
          .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
          .eq('id', raffleId)
      } catch {
        // swallow - we still return the on-chain signature
      }
    }
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Prize escrow transfer failed for raffle ${raffleId}:`, err)
    // Release lock so the winner can retry if the transfer fails.
    try {
      await getSupabaseAdmin()
        .from('raffles')
        .update({ nft_claim_locked_at: null, nft_claim_locked_wallet: null })
        .eq('id', raffleId)
    } catch {
      // ignore
    }
    return { ok: false, error: humanizeSplPrizeTransferError(message) }
  }
}

/** Allowed reasons for returning the NFT prize to the creator (admin or automation). */
export const PRIZE_RETURN_REASONS = [
  'cancelled',
  'wrong_nft',
  'dispute',
  'platform_error',
  'testing',
  'min_threshold_not_met',
] as const
export type PrizeReturnReason = (typeof PRIZE_RETURN_REASONS)[number]

async function persistPrizeReturnToCreator(
  raffleId: string,
  reason: PrizeReturnReason,
  signature: string
): Promise<void> {
  const now = new Date().toISOString()
  await updateRaffle(raffleId, {
    prize_returned_at: now,
    prize_return_reason: reason,
    prize_return_tx: signature,
    nft_claim_locked_at: null,
    nft_claim_locked_wallet: null,
  })
}

/**
 * How the prize is held in escrow for return routing (matches checkEscrowHoldsNft probe order for legacy rows).
 */
async function detectPrizeReturnKind(
  raffle: Raffle
): Promise<'spl' | 'mpl_core' | 'compressed' | null> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) return null
  const standard = raffle.prize_standard ?? null
  const preferredMint = (raffle.nft_mint_address || '').trim()
  const escrowPk = keypair.publicKey

  if (standard === 'mpl_core') return 'mpl_core'
  if (standard === 'compressed') return 'compressed'

  if (standard === 'spl' || standard === 'token2022') {
    if (!preferredMint) return null
    try {
      const mint = new PublicKey(preferredMint)
      const tp = await getEscrowTokenProgramForMint(mint, escrowPk)
      if (tp) return 'spl'
    } catch {
      return null
    }
    return null
  }

  // Legacy / unknown: SPL Token or Token-2022 ATA first
  const connection = getSolanaConnection()
  if (preferredMint) {
    try {
      const mint = new PublicKey(preferredMint)
      for (const programId of TOKEN_PROGRAM_IDS) {
        try {
          const ata = await getAssociatedTokenAddress(
            mint,
            escrowPk,
            false,
            programId,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
          const account = await getAccount(connection, ata, 'confirmed', programId)
          if (account.amount >= NFT_AMOUNT) return 'spl'
        } catch {
          // try next program
        }
      }
    } catch {
      // bad mint
    }
  }

  const coreCandidates = Array.from(
    new Set(
      [raffle.nft_token_id, raffle.nft_mint_address]
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    )
  )
  for (const assetId of coreCandidates) {
    try {
      if (await isMplCoreAssetInEscrow(assetId)) return 'mpl_core'
    } catch {
      // try next
    }
  }

  const escrowBase58 = escrowPk.toBase58()
  const endpoint = resolveServerSolanaRpcUrl()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())
    const assetIdCandidates = Array.from(
      new Set(
        [raffle.nft_token_id, raffle.nft_mint_address]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .map((v) => v.trim())
      )
    )
    for (const assetId of assetIdCandidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
        const leafOwnerStr = asset?.leafOwner ? String(asset.leafOwner) : ''
        if (leafOwnerStr === escrowBase58) return 'compressed'
      } catch {
        // try next id
      }
    }
  } catch {
    return null
  }

  return null
}

/** SPL / Token-2022: return verified mint from escrow list to creator. */
async function transferSplPrizeToCreatorFromEscrow(
  raffleId: string,
  raffle: Raffle,
  reason: PrizeReturnReason,
  creatorWallet: string
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const held = await getEscrowHeldNftMints()
  if (held.length === 0) {
    return {
      ok: false,
      error: `Escrow has no SPL NFTs to return. Escrow: ${keypair.publicKey.toBase58()}.`,
    }
  }
  const preferredMint = (raffle.nft_mint_address || '').trim()
  if (!preferredMint) {
    return {
      ok: false,
      error: 'Raffle NFT mint is missing. Re-verify prize deposit before attempting return.',
    }
  }
  const chosen = held.find((h) => h.mint === preferredMint)
  if (!chosen) {
    return {
      ok: false,
      error: `Escrow does not hold this raffle's verified mint (${preferredMint}) as SPL/Token-2022.`,
    }
  }

  const connection = getSolanaConnection()
  const mint = new PublicKey(chosen.mint)
  const creatorPubkey = new PublicKey(creatorWallet)

  const tokenProgram = await getEscrowTokenProgramForMint(mint, keypair.publicKey)
  if (!tokenProgram) {
    return {
      ok: false,
      error: `Escrow reports no SPL balance for mint ${chosen.mint}. Escrow: ${keypair.publicKey.toBase58()}.`,
    }
  }

  const sourceAta = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  const CONFIRMED = 'confirmed' as const
  let sourceAccount
  try {
    sourceAccount = await getAccount(connection, sourceAta, CONFIRMED, tokenProgram)
    if (sourceAccount.amount < NFT_AMOUNT) {
      return {
        ok: false,
        error: `Escrow token account has no balance for mint ${chosen.mint}. Escrow: ${keypair.publicKey.toBase58()}.`,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: `Escrow token account not found (${msg}). Mint: ${chosen.mint}. Escrow: ${keypair.publicKey.toBase58()}.`,
    }
  }

  const thawRes = await resolveThawSignerIfEscrowSourceFrozen(
    connection,
    mint,
    sourceAccount.isFrozen,
    tokenProgram,
    keypair
  )
  if (!thawRes.ok) {
    return { ok: false, error: thawRes.error }
  }
  const thawSigner = thawRes.thawSigner

  const destAta = await getAssociatedTokenAddress(
    mint,
    creatorPubkey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  let destAccountExists = false
  try {
    await getAccount(connection, destAta, CONFIRMED, tokenProgram)
    destAccountExists = true
  } catch {
    destAccountExists = false
  }

  const tx = new Transaction()
  if (thawSigner) {
    tx.add(
      createThawAccountInstruction(sourceAta, mint, thawSigner.publicKey, [], tokenProgram)
    )
  }
  if (!destAccountExists) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        destAta,
        creatorPubkey,
        mint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(
    createTransferInstruction(
      sourceAta,
      destAta,
      keypair.publicKey,
      NFT_AMOUNT,
      [],
      tokenProgram
    )
  )

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = keypair.publicKey
    tx.sign(...collectTxSigners(keypair, thawSigner))

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    await persistPrizeReturnToCreator(raffleId, reason, sig)
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Prize return to creator failed for raffle ${raffleId}:`, err)
    if (message.includes('Attempt to debit') || message.includes('debit an account')) {
      return {
        ok: false,
        error: `Transfer failed: escrow token account has no balance. Mint used: ${chosen.mint}. Escrow: ${keypair.publicKey.toBase58()}.`,
      }
    }
    return { ok: false, error: humanizeSplPrizeTransferError(message) }
  }
}

/** MPL Core: transfer asset from escrow to creator (mirror winner flow). */
async function transferMplCorePrizeToCreatorFromEscrow(
  raffleId: string,
  raffle: Raffle,
  reason: PrizeReturnReason,
  creatorWallet: string
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const mintStr = (raffle.nft_mint_address || '').trim()
  if (!mintStr) {
    return { ok: false, error: 'Raffle NFT (Core asset) address is missing' }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  try {
    if (!(await isMplCoreAssetInEscrow(mintStr))) {
      return {
        ok: false,
        error:
          'MPL Core asset is not owned by the prize escrow, or the asset id does not match this raffle.',
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `MPL Core escrow check failed: ${message}` }
  }

  const endpoint = resolveServerSolanaRpcUrl()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umi: any = (createUmi as any)(endpoint as any)
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))

  const asset = umiPublicKey(mintStr)
  const newOwner = umiPublicKey(creatorWallet.trim())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetAccount: any = await fetchAsset(umi as any, asset)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = transferV1(umi as any, {
      asset,
      newOwner,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await builder.sendAndConfirm(umi as any)
    const sig = String(result.signature ?? result)
    await persistPrizeReturnToCreator(raffleId, reason, sig)
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`MPL Core prize return to creator failed for raffle ${raffleId}:`, err)
    return { ok: false, error: message }
  }
}

/** Compressed (Bubblegum): transfer from escrow leaf to creator. */
async function transferCompressedPrizeToCreatorFromEscrow(
  raffleId: string,
  raffle: Raffle,
  reason: PrizeReturnReason,
  creatorWallet: string
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const assetId = (raffle.nft_mint_address || raffle.nft_token_id || '').trim()
  if (!assetId) {
    return { ok: false, error: 'Missing compressed NFT asset id' }
  }

  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const escrowBase58 = keypair.publicKey.toBase58()
  const endpoint = resolveServerSolanaRpcUrl()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
  const signer = createSignerFromKeypair(umi, umiKeypair)
  umi.use(signerIdentity(signer))

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
    const leafOwnerStr = asset?.leafOwner ? String(asset.leafOwner) : ''
    if (leafOwnerStr !== escrowBase58) {
      return {
        ok: false,
        error:
          'Compressed NFT is not in the prize escrow under this asset id, or the asset is not compressed.',
      }
    }

    const { compressionProgram, logWrapper } = await getCompressionProgramsForV1Ixs(umi)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = bubblegumTransfer(umi, {
      leafOwner: umiPublicKey(escrowBase58),
      leafDelegate: asset.leafDelegate,
      newLeafOwner: umiPublicKey(creatorWallet.trim()),
      merkleTree: asset.merkleTree,
      root: asset.root,
      dataHash: asset.dataHash,
      creatorHash: asset.creatorHash,
      nonce: BigInt(asset.nonce),
      index: asset.index,
      proof: asset.proof,
      compressionProgram,
      logWrapper,
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await builder.sendAndConfirm(umi)
    const sig = String(result.signature ?? result)
    await persistPrizeReturnToCreator(raffleId, reason, sig)
    return { ok: true, signature: sig }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Compressed prize return to creator failed for raffle ${raffleId}:`, err)
    return { ok: false, error: message }
  }
}

/**
 * Transfer the NFT prize from the platform escrow back to the raffle creator.
 * Supports SPL Token, Token-2022, MPL Core, and compressed (Bubblegum) prizes.
 * Idempotent if prize_returned_at already set. Call with a valid reason (admin or terminal min-threshold flow).
 */
export async function transferNftPrizeToCreator(
  raffleId: string,
  reason: PrizeReturnReason
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const raffle = await getRaffleById(raffleId)
  if (!raffle) {
    return { ok: false, error: 'Raffle not found' }
  }
  if (raffle.prize_type !== 'nft') {
    return { ok: false, error: 'Raffle is not an NFT raffle' }
  }
  if (!raffle.prize_deposited_at) {
    return {
      ok: false,
      error:
        'Prize deposit is not verified for this raffle. Cannot return from escrow before a verified deposit.',
    }
  }
  const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
  if (!creatorWallet) {
    return { ok: false, error: 'Raffle has no creator wallet to return the prize to' }
  }
  if (raffle.nft_transfer_transaction) {
    return { ok: false, error: 'Prize was already sent to winner; cannot return to creator' }
  }
  if (raffle.prize_returned_at) {
    return { ok: true, signature: raffle.prize_return_tx ?? undefined }
  }

  if (!getPrizeEscrowKeypair()) {
    return { ok: false, error: 'Prize escrow not configured (PRIZE_ESCROW_SECRET_KEY)' }
  }

  const kind = await detectPrizeReturnKind(raffle)
  if (!kind) {
    const holdCheck = await checkEscrowHoldsNft(raffle)
    return {
      ok: false,
      error:
        holdCheck.error ??
        'Could not determine how this NFT is held in escrow (SPL, MPL Core, or compressed).',
    }
  }

  if (kind === 'spl') {
    return transferSplPrizeToCreatorFromEscrow(raffleId, raffle, reason, creatorWallet)
  }
  if (kind === 'mpl_core') {
    return transferMplCorePrizeToCreatorFromEscrow(raffleId, raffle, reason, creatorWallet)
  }
  return transferCompressedPrizeToCreatorFromEscrow(raffleId, raffle, reason, creatorWallet)
}

/**
 * Check if the escrow still holds this raffle's NFT prize.
 * SPL / Token-2022: ATA balance; MPL Core: asset owner; compressed: Bubblegum leaf owner (DAS).
 * Legacy rows may omit `prize_standard` — after SPL fails, tries Core then compressed (same as verify-prize-deposit).
 */
export async function checkEscrowHoldsNft(raffle: Raffle): Promise<{ holds: boolean; error?: string }> {
  if (raffle.prize_type !== 'nft' || !raffle.nft_mint_address) {
    return { holds: false, error: 'Not an NFT raffle or missing mint' }
  }
  const keypair = getPrizeEscrowKeypair()
  if (!keypair) {
    return { holds: false, error: 'Prize escrow not configured' }
  }
  const connection = getSolanaConnection()
  const standard = raffle.prize_standard ?? null
  const escrowPk = keypair.publicKey

  const splEscrowHoldsMint = async (mintStr: string): Promise<boolean> => {
    const mint = new PublicKey(mintStr)
    for (const programId of TOKEN_PROGRAM_IDS) {
      try {
        const ata = await getAssociatedTokenAddress(
          mint,
          escrowPk,
          false,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const account = await getAccount(connection, ata)
        if (account.amount >= NFT_AMOUNT) return true
      } catch {
        // no account or wrong program
      }
    }
    return false
  }

  const mplCoreEscrowHolds = async (assetId: string): Promise<boolean> => {
    try {
      return await isMplCoreAssetInEscrow(assetId)
    } catch {
      return false
    }
  }

  const compressedEscrowHolds = async (): Promise<boolean> => {
    const escrowBase58 = escrowPk.toBase58()
    const endpoint = resolveServerSolanaRpcUrl()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())
      const assetIdCandidates = Array.from(
        new Set(
          [raffle.nft_token_id, raffle.nft_mint_address]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((v) => v.trim())
        )
      )
      for (const assetId of assetIdCandidates) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
          const leafOwner = asset?.leafOwner
          if (leafOwner && String(leafOwner) === escrowBase58) return true
        } catch {
          // try next id
        }
      }
    } catch {
      return false
    }
    return false
  }

  const notFoundMsg =
    'NFT not found in escrow (tried SPL Token, Token-2022, MPL Core, and compressed)'

  if (standard === 'mpl_core') {
    const id = raffle.nft_mint_address.trim()
    if (await mplCoreEscrowHolds(id)) return { holds: true }
    return { holds: false, error: 'MPL Core NFT not found in escrow (owner check failed)' }
  }

  if (standard === 'compressed') {
    if (await compressedEscrowHolds()) return { holds: true }
    return { holds: false, error: 'Compressed NFT not found in escrow (leaf owner check failed)' }
  }

  const preferredMint = raffle.nft_mint_address.trim()
  if (await splEscrowHoldsMint(preferredMint)) return { holds: true }

  const coreCandidates = Array.from(
    new Set(
      [raffle.nft_token_id, raffle.nft_mint_address]
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean)
    )
  )
  for (const assetId of coreCandidates) {
    if (await mplCoreEscrowHolds(assetId)) return { holds: true }
  }
  if (await compressedEscrowHolds()) return { holds: true }

  return { holds: false, error: notFoundMsg }
}

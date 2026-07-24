import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createSignerFromKeypair, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { fetchAsset, fetchAssetV1, transferV1 } from '@metaplex-foundation/mpl-core'
import { getSolanaConnection, getSolanaReadConnection } from '@/lib/solana/connection'
import { resolveServerSolanaRpcUrl, resolveServerSolanaReadRpcUrl } from '@/lib/solana-rpc-url'
import { trySendSplNftViaTokenMetadataFromEscrow } from '@/lib/solana/token-metadata-prize-payout'
import { umiSignatureToBase58 } from '@/lib/solana/umi-signature'
import { getTokenInfo } from '@/lib/tokens'
import {
  getDiscordMarketplaceEscrowKeypair,
  getDiscordMarketplaceEscrowPublicKey,
} from '@/lib/solana/discord-marketplace-escrow-keypair'

export { getDiscordMarketplaceEscrowPublicKey }

const NFT_AMOUNT = 1n
const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

async function getEscrowTokenProgramForMint(
  mint: PublicKey,
  escrowOwner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  const connection = getSolanaReadConnection()
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
      // try next
    }
  }
  return null
}

async function mplCoreInEscrow(assetId: string, escrowB58: string): Promise<boolean> {
  try {
    const endpoint = resolveServerSolanaReadRpcUrl()
    const umi: any = (createUmi as any)(endpoint as any)
    const asset: any = await fetchAssetV1(umi, umiPublicKey(assetId))
    return asset.owner?.toString() === escrowB58
  } catch {
    return false
  }
}

async function compressedInEscrow(assetId: string, escrowB58: string): Promise<boolean> {
  try {
    const endpoint = resolveServerSolanaRpcUrl()
    const umi: any = (createUmi as any)(endpoint as any).use(dasApi()).use(mplBubblegum())
    const asset: any = await getAssetWithProof(umi, umiPublicKey(assetId), { truncateCanopy: true })
    return asset?.leafOwner != null && String(asset.leafOwner) === escrowB58
  } catch {
    return false
  }
}

export async function marketplaceEscrowHoldsNft(mint: string): Promise<{ ok: boolean; error?: string }> {
  const keypair = getDiscordMarketplaceEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Marketplace escrow not configured (DISCORD_MARKETPLACE_ESCROW_SECRET_KEY)' }
  }
  const mintStr = mint.trim()
  const escrowB58 = keypair.publicKey.toBase58()

  const spl = await getEscrowTokenProgramForMint(new PublicKey(mintStr), keypair.publicKey)
  if (spl) return { ok: true }

  if (await mplCoreInEscrow(mintStr, escrowB58)) return { ok: true }
  if (await compressedInEscrow(mintStr, escrowB58)) return { ok: true }

  return { ok: false, error: 'NFT not found in marketplace escrow wallet' }
}

export async function marketplaceEscrowOwlBalanceUi(): Promise<number> {
  const keypair = getDiscordMarketplaceEscrowKeypair()
  const owl = getTokenInfo('OWL')
  if (!keypair || !owl.mintAddress) return 0
  const connection = getSolanaReadConnection()
  const mint = new PublicKey(owl.mintAddress)
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        keypair.publicKey,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const acc = await getAccount(connection, ata, 'confirmed', programId)
      return Number(acc.amount) / Math.pow(10, owl.decimals)
    } catch {
      // try next
    }
  }
  return 0
}

export async function marketplaceEscrowHoldsOwl(amountUi: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(amountUi) || amountUi <= 0) {
    return { ok: false, error: 'Invalid OWL amount' }
  }
  const balance = await marketplaceEscrowOwlBalanceUi()
  if (balance + 1e-9 < amountUi) {
    return {
      ok: false,
      error: `Marketplace escrow has ${balance} OWL; need at least ${amountUi} OWL deposited`,
    }
  }
  return { ok: true }
}

export async function payoutNftFromMarketplaceEscrow(
  mint: string,
  recipientWallet: string
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const keypair = getDiscordMarketplaceEscrowKeypair()
  if (!keypair) {
    return { ok: false, error: 'Marketplace escrow not configured' }
  }

  const spl = await payoutSplNftFromMarketplaceEscrow(keypair, mint, recipientWallet)
  if (spl.ok) return spl

  const core = await payoutMplCoreFromMarketplaceEscrow(keypair, mint, recipientWallet)
  if (core.ok) return core

  return { ok: false, error: spl.error ?? core.error ?? 'NFT payout failed' }
}

async function payoutMplCoreFromMarketplaceEscrow(
  keypair: Keypair,
  assetMintAddress: string,
  recipientWallet: string
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  try {
    const endpoint = resolveServerSolanaRpcUrl()
    const umi: any = (createUmi as any)(endpoint as any)
    const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypair.secretKey)
    const signer = createSignerFromKeypair(umi, umiKeypair)
    umi.use(signerIdentity(signer))
    const asset = umiPublicKey(assetMintAddress.trim())
    const newOwner = umiPublicKey(recipientWallet.trim())
    const assetAccount: any = await fetchAsset(umi as any, asset)
    const maybeCollection: any =
      assetAccount?.updateAuthority?.type === 'Collection'
        ? assetAccount.updateAuthority.address
        : undefined
    const builder: any = transferV1(umi as any, {
      asset,
      newOwner,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    } as any)
    const result: any = await builder.sendAndConfirm(umi as any)
    return { ok: true, signature: umiSignatureToBase58(result) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'MPL Core transfer failed' }
  }
}

async function payoutSplNftFromMarketplaceEscrow(
  keypair: Keypair,
  mintAddress: string,
  recipientWallet: string
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const readConn = getSolanaReadConnection()
  const connection = getSolanaConnection()
  const mint = new PublicKey(mintAddress.trim())
  const recipient = new PublicKey(recipientWallet.trim())

  const tokenProgram = await getEscrowTokenProgramForMint(mint, keypair.publicKey)
  if (!tokenProgram) {
    return { ok: false, error: 'Escrow does not hold this NFT as SPL' }
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
    recipient,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  if (tokenProgram.equals(TOKEN_PROGRAM_ID)) {
    const tm = await trySendSplNftViaTokenMetadataFromEscrow({
      connection,
      escrowKeypair: keypair,
      mint,
      destinationOwner: recipient,
    })
    if (tm) return { ok: true, signature: tm.signature }
  }

  const tx = new Transaction()
  try {
    await getAccount(readConn, destAta, 'confirmed', tokenProgram)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        destAta,
        recipient,
        mint,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(
    createTransferInstruction(sourceAta, destAta, keypair.publicKey, NFT_AMOUNT, [], tokenProgram)
  )

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = keypair.publicKey
    tx.sign(keypair)
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature: sig }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'SPL NFT transfer failed' }
  }
}

export async function payoutOwlFromMarketplaceEscrow(
  recipientWallet: string,
  amountUi: number
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const keypair = getDiscordMarketplaceEscrowKeypair()
  if (!keypair) return { ok: false, error: 'Marketplace escrow not configured' }

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) return { ok: false, error: 'OWL mint not configured' }

  const hold = await marketplaceEscrowHoldsOwl(amountUi)
  if (!hold.ok) return { ok: false, error: hold.error ?? 'Insufficient OWL in escrow' }

  let recipient: PublicKey
  try {
    recipient = new PublicKey(recipientWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid recipient wallet' }
  }

  const mint = new PublicKey(owl.mintAddress)
  const amountRaw = BigInt(Math.round(amountUi * Math.pow(10, owl.decimals)))
  const connection = getSolanaConnection()
  const readConn = getSolanaReadConnection()

  let programId: typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null = null
  for (const pid of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(mint, keypair.publicKey, false, pid, ASSOCIATED_TOKEN_PROGRAM_ID)
      await getAccount(readConn, ata, 'confirmed', pid)
      programId = pid
      break
    } catch {
      // try next
    }
  }
  if (!programId) return { ok: false, error: 'Marketplace escrow has no OWL token account' }

  const fromAta = await getAssociatedTokenAddress(
    mint,
    keypair.publicKey,
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

  const tx = new Transaction()
  try {
    await getAccount(readConn, toAta, 'confirmed', programId)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        toAta,
        recipient,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, keypair.publicKey, amountRaw, [], programId))

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = keypair.publicKey
    const sig = await connection.sendTransaction(tx, [keypair], {
      skipPreflight: false,
      preflightCommitment: 'processed',
      maxRetries: 3,
    })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'processed')
    return { ok: true, signature: sig }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'OWL transfer from escrow failed' }
  }
}

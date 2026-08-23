/**
 * Packs vault: funded wallet that receives ALL pack purchase SOL and pays prizes.
 * Env: PACKS_VAULT_SECRET_KEY (JSON 64-byte array or base58)
 *      NEXT_PUBLIC_PACKS_VAULT_WALLET (public address; should match the secret key)
 *
 * Grind an Owl-branded address: `npm run packs:grind-vault` (prefix owL — base58 has no O/l).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token'
import { getSolanaConnection, getSolanaReadConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'
import {
  payoutCompressedFromKeypair,
  payoutMplCoreFromKeypair,
} from '@/lib/solana/payout-nft-from-keypair'
import type { PackInventoryPrizeStandard } from '@/lib/packs/types'

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
     
    const bs58 = require('bs58') as { decode: (s: string) => Uint8Array }
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

let vaultKeypairCache: Keypair | null | undefined

export function getPacksVaultKeypair(): Keypair | null {
  if (vaultKeypairCache !== undefined) return vaultKeypairCache
  vaultKeypairCache = parseSolanaSecretKeyFromEnv(process.env.PACKS_VAULT_SECRET_KEY)
  return vaultKeypairCache
}

export function getPacksVaultPublicKey(): string | null {
  const fromEnv = process.env.NEXT_PUBLIC_PACKS_VAULT_WALLET?.trim()
  const kp = getPacksVaultKeypair()
  const derived = kp ? kp.publicKey.toBase58() : null

  if (fromEnv && derived && fromEnv !== derived) {
    console.error(
      '[packs/vault] NEXT_PUBLIC_PACKS_VAULT_WALLET does not match PACKS_VAULT_SECRET_KEY — fix env before using packs'
    )
    return null
  }

  if (fromEnv) return fromEnv
  return derived
}

async function resolveTokenProgramForMint(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID | null> {
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = await getAssociatedTokenAddress(mint, owner, false, program, ASSOCIATED_TOKEN_PROGRAM_ID)
      await getAccount(connection, ata, 'confirmed', program)
      return program
    } catch {
      // try next
    }
  }
  // Mint exists? Prefer classic SPL if mint account owned by Token program
  try {
    const info = await connection.getAccountInfo(mint, 'confirmed')
    if (info?.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
    if (info?.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  } catch {
    // ignore
  }
  return TOKEN_PROGRAM_ID
}

export async function payoutSolFromPacksVault(
  recipientWallet: string,
  lamports: bigint
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  if (lamports <= 0n) return { ok: false, error: 'Payout amount must be positive.' }
  const keypair = getPacksVaultKeypair()
  if (!keypair) return { ok: false, error: 'Packs vault not configured (PACKS_VAULT_SECRET_KEY)' }

  const connection = getSolanaConnection()
  const recipient = new PublicKey(recipientWallet)
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'Amount too large for SOL transfer encoding.' }
  }
  const balance = await connection.getBalance(keypair.publicKey, 'confirmed')
  const needed = lamports + 5000n
  if (BigInt(balance) < needed) {
    return { ok: false, error: 'Packs vault SOL balance too low for payout (+ fee).' }
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipient,
      lamports: Number(lamports),
    })
  )
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey
  tx.sign(keypair)
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function payoutOwlFromPacksVault(
  recipientWallet: string,
  owlAmount: number
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  if (!(owlAmount > 0)) return { ok: false, error: 'OWL amount must be positive.' }
  const keypair = getPacksVaultKeypair()
  if (!keypair) return { ok: false, error: 'Packs vault not configured (PACKS_VAULT_SECRET_KEY)' }

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) return { ok: false, error: 'OWL mint not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS)' }

  const connection = getSolanaConnection()
  const readConn = getSolanaReadConnection()
  const mint = new PublicKey(owl.mintAddress)
  const recipient = new PublicKey(recipientWallet)
  const tokenProgram = await resolveTokenProgramForMint(readConn, mint, keypair.publicKey)
  if (!tokenProgram) return { ok: false, error: 'Could not resolve OWL token program' }

  const mintInfo = await getMint(readConn, mint, 'confirmed', tokenProgram)
  const raw = BigInt(Math.round(owlAmount * 10 ** mintInfo.decimals))
  if (raw <= 0n) return { ok: false, error: 'OWL raw amount is zero' }

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
    createTransferInstruction(sourceAta, destAta, keypair.publicKey, raw, [], tokenProgram)
  )

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey
  tx.sign(keypair)
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function isVaultSplMissingNftError(error: string | undefined): boolean {
  if (!error) return false
  return (
    error.includes('Vault does not hold this NFT') ||
    error.includes('Vault does not hold this NFT mint') ||
    error.includes('Vault NFT balance is zero')
  )
}

async function payoutSplNftFromPacksVault(
  keypair: Keypair,
  mintAddress: string,
  recipientWallet: string
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const connection = getSolanaConnection()
  const readConn = getSolanaReadConnection()
  const mint = new PublicKey(mintAddress)
  const recipient = new PublicKey(recipientWallet)
  const tokenProgram = await resolveTokenProgramForMint(readConn, mint, keypair.publicKey)
  if (!tokenProgram) return { ok: false, error: 'Vault does not hold this NFT mint' }

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

  try {
    const acct = await getAccount(readConn, sourceAta, 'confirmed', tokenProgram)
    if (acct.amount < 1n) return { ok: false, error: 'Vault NFT balance is zero' }
  } catch {
    return { ok: false, error: 'Vault does not hold this NFT' }
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
    createTransferInstruction(sourceAta, destAta, keypair.publicKey, 1n, [], tokenProgram)
  )

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey
  tx.sign(keypair)
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Transfer an NFT prize from the packs vault to the winner (SPL, Core, or compressed). */
export async function payoutNftFromPacksVault(
  mintAddress: string,
  recipientWallet: string,
  prizeStandard?: PackInventoryPrizeStandard | null
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const keypair = getPacksVaultKeypair()
  if (!keypair) return { ok: false, error: 'Packs vault not configured (PACKS_VAULT_SECRET_KEY)' }

  if (prizeStandard === 'mpl_core') {
    return payoutMplCoreFromKeypair(keypair, mintAddress, recipientWallet)
  }
  if (prizeStandard === 'compressed') {
    return payoutCompressedFromKeypair(keypair, mintAddress, recipientWallet)
  }

  const spl = await payoutSplNftFromPacksVault(keypair, mintAddress, recipientWallet)
  if (spl.ok) return spl
  if (!isVaultSplMissingNftError(spl.error)) return spl

  const core = await payoutMplCoreFromKeypair(keypair, mintAddress, recipientWallet)
  if (core.ok) return core
  const compressed = await payoutCompressedFromKeypair(keypair, mintAddress, recipientWallet)
  if (compressed.ok) return compressed
  return { ok: false, error: spl.error || core.error || compressed.error || 'NFT payout failed' }
}

export async function getPacksVaultSolBalance(): Promise<number | null> {
  const pubkey = getPacksVaultPublicKey()
  if (!pubkey) return null
  try {
    const bal = await getSolanaReadConnection().getBalance(new PublicKey(pubkey), 'confirmed')
    return bal / LAMPORTS_PER_SOL
  } catch {
    return null
  }
}

/** Human-readable OWL balance in the packs vault (0 if no ATA). */
export async function getPacksVaultOwlBalanceUi(): Promise<number | null> {
  const pubkey = getPacksVaultPublicKey()
  if (!pubkey) return null
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) return null

  try {
    const connection = getSolanaReadConnection()
    const owner = new PublicKey(pubkey)
    const mint = new PublicKey(owl.mintAddress)

    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      try {
        const ata = await getAssociatedTokenAddress(
          mint,
          owner,
          false,
          program,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
        const acc = await getAccount(connection, ata, 'confirmed', program)
        return Number(acc.amount) / 10 ** owl.decimals
      } catch {
        // try next program or no ATA
      }
    }
    return 0
  } catch {
    return null
  }
}

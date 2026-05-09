import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey, Transaction } from '@solana/web3.js'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getNestingConnection, getNestingReadConnection } from '@/lib/solana/nesting/client'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { getNestingStakeVaultKeypair } from '@/lib/nesting/vault-keypair'

function tokenDeltaForOwnerMint(
  meta: NonNullable<ParsedTransactionWithMeta['meta']>,
  ownerB58: string,
  mintB58: string
): bigint {
  const pre = meta.preTokenBalances ?? []
  const post = meta.postTokenBalances ?? []
  const preBalance = pre.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const postBalance = post.find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const preAmount = preBalance?.uiTokenAmount?.amount != null ? BigInt(preBalance.uiTokenAmount.amount) : 0n
  const postAmount = postBalance?.uiTokenAmount?.amount != null ? BigInt(postBalance.uiTokenAmount.amount) : 0n
  return postAmount - preAmount
}

export function getOwlStakeMintForPool(pool: StakingPoolRow): string | null {
  const owl = getTokenInfo('OWL')
  const configured = pool.stake_mint?.trim() || pool.token_mint?.trim() || owl.mintAddress
  if (!configured || !owl.mintAddress) return null
  if (configured !== owl.mintAddress) return null
  return configured
}

export function getVaultOwnerForPool(pool: StakingPoolRow): string | null {
  return pool.vault_address?.trim() || null
}

export type VerifyNestingTokenStakeTransferResult =
  | { ok: true; amountRaw: bigint; parsedTransaction: ParsedTransactionWithMeta }
  | { ok: false; error: string }

export async function verifyNestingTokenStakeTransfer(params: {
  signature: string
  payerWallet: string
  pool: StakingPoolRow
  expectedAmountRaw: bigint
  parsedTransaction?: ParsedTransactionWithMeta | null
}): Promise<VerifyNestingTokenStakeTransferResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing transaction signature' }
  if (!isOwlEnabled()) return { ok: false, error: 'OWL token is not configured on this deployment' }
  if (params.expectedAmountRaw <= 0n) return { ok: false, error: 'Stake amount must be positive' }

  const mintB58 = getOwlStakeMintForPool(params.pool)
  if (!mintB58) return { ok: false, error: 'Pool stake mint must be the configured OWL mint' }

  const vaultB58 = getVaultOwnerForPool(params.pool)
  if (!vaultB58) return { ok: false, error: 'Pool vault address is not configured' }

  let payer: PublicKey
  try {
    payer = new PublicKey(params.payerWallet.trim())
    new PublicKey(vaultB58)
  } catch {
    return { ok: false, error: 'Invalid wallet or vault address' }
  }

  const tx =
    params.parsedTransaction ??
    (await getNestingReadConnection().getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    }))

  if (!tx || !tx.meta || tx.meta.err) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }

  const vaultDelta = tokenDeltaForOwnerMint(tx.meta, vaultB58, mintB58)
  const payerDelta = tokenDeltaForOwnerMint(tx.meta, payer.toBase58(), mintB58)
  const expected = params.expectedAmountRaw
  const tolerance = 1n

  if (vaultDelta < expected - tolerance || vaultDelta > expected + tolerance) {
    return { ok: false, error: 'OWL credited to the staking vault does not match this stake amount' }
  }

  if (payerDelta > -expected + tolerance || payerDelta < -expected - tolerance) {
    return { ok: false, error: 'OWL debit from your wallet does not match the staking vault credit' }
  }

  return { ok: true, amountRaw: vaultDelta, parsedTransaction: tx }
}

export async function transferNestingTokenFromVaultToWallet(params: {
  pool: StakingPoolRow
  recipientWallet: string
  amountRaw: bigint
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  if (!isOwlEnabled()) return { ok: false, error: 'OWL token is not configured' }
  if (params.amountRaw <= 0n) return { ok: false, error: 'Unstake amount must be positive' }

  const mintB58 = getOwlStakeMintForPool(params.pool)
  if (!mintB58) return { ok: false, error: 'Pool stake mint must be the configured OWL mint' }

  const vault = getNestingStakeVaultKeypair()
  if (!vault) {
    return { ok: false, error: 'NESTING_STAKE_VAULT_SECRET_KEY is required for on-chain unstake' }
  }

  const vaultOwner = getVaultOwnerForPool(params.pool)
  if (!vaultOwner || vault.publicKey.toBase58() !== vaultOwner) {
    return { ok: false, error: 'Configured vault signer does not match this pool vault address' }
  }

  let recipient: PublicKey
  try {
    recipient = new PublicKey(params.recipientWallet.trim())
  } catch {
    return { ok: false, error: 'Invalid recipient wallet' }
  }

  const connection = getNestingConnection()
  const mint = new PublicKey(mintB58)
  const fromAta = await getAssociatedTokenAddress(mint, vault.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const toAta = await getAssociatedTokenAddress(mint, recipient, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)

  const tx = new Transaction()
  try {
    await getAccount(connection, toAta, 'confirmed', TOKEN_PROGRAM_ID)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        vault.publicKey,
        toAta,
        recipient,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, vault.publicKey, params.amountRaw, [], TOKEN_PROGRAM_ID))

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    tx.recentBlockhash = blockhash
    tx.feePayer = vault.publicKey
    const signature = await connection.sendTransaction(tx, [vault], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unstake transfer failed' }
  }
}

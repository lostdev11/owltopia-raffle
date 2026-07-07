import {
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { StakingUserError } from '@/lib/nesting/errors'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { getNestingNftFreezeAuthorityKeypair } from '@/lib/nesting/freeze-authority-keypair'

/**
 * SPL token-account nest lock for legacy / Candy Machine NFTs (Gen 2, many partners).
 * Non-custodial: freezeAccount on the holder's ATA only — ownership never leaves their wallet.
 */

export type SplTokenNestAccountState = {
  mint: string
  ownerWallet: string
  tokenAccount: string
  isFrozen: boolean
  mintFreezeAuthority: string | null
  delegate: string | null
  nestingAuthorityCanFreeze: boolean
  heldByNestingLock: boolean
}

function nestingAuthorityPublicKey(): PublicKey | null {
  return getNestingNftFreezeAuthorityKeypair()?.publicKey ?? null
}

export function resolveSplTokenNestAta(mint: string, ownerWallet: string): PublicKey {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint.trim()),
    new PublicKey(ownerWallet.trim()),
    false,
    TOKEN_PROGRAM_ID
  )
}

export async function readSplTokenNestAccountState(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
}): Promise<SplTokenNestAccountState> {
  const mintPk = new PublicKey(params.mint.trim())
  const ownerPk = new PublicKey(params.ownerWallet.trim())
  const nestingPk = nestingAuthorityPublicKey()
  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const tokenAccount = resolveSplTokenNestAta(params.mint, params.ownerWallet)

  const mintInfo = await getMint(connection, mintPk, undefined, TOKEN_PROGRAM_ID)
  const mintFreezeAuthority = mintInfo.freezeAuthority?.toBase58() ?? null
  const nestingAuthorityCanFreeze =
    nestingPk != null && mintInfo.freezeAuthority?.equals(nestingPk) === true

  let isFrozen = false
  let delegate: string | null = null
  try {
    const acct = await getAccount(connection, tokenAccount, undefined, TOKEN_PROGRAM_ID)
    isFrozen = acct.isFrozen
    delegate = acct.delegate?.toBase58() ?? null
  } catch {
    // Missing ATA — treat as not frozen / not held.
  }

  const heldByNestingLock = isFrozen && nestingAuthorityCanFreeze

  return {
    mint: mintPk.toBase58(),
    ownerWallet: ownerPk.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    isFrozen,
    mintFreezeAuthority,
    delegate,
    nestingAuthorityCanFreeze,
    heldByNestingLock,
  }
}

export async function freezeSplTokenNestAccount(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
  authority?: Keypair
}): Promise<{ signature: string; tokenAccount: string }> {
  const authority = params.authority ?? getNestingNftFreezeAuthorityKeypair()
  if (!authority) {
    throw new StakingUserError(
      'NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY is required for SPL nest locks.',
      503
    )
  }

  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const state = await readSplTokenNestAccountState({
    mint: params.mint,
    ownerWallet: params.ownerWallet,
    connection,
  })

  if (state.heldByNestingLock) {
    return { signature: '', tokenAccount: state.tokenAccount }
  }

  if (state.isFrozen && !state.heldByNestingLock) {
    throw new StakingUserError(
      'This NFT token account is frozen by another program and cannot be nested yet.',
      400,
      { code: 'mint_collection_frozen' }
    )
  }

  if (!state.nestingAuthorityCanFreeze) {
    throw new StakingUserError(
      'This NFT mint freeze authority is not assigned to Owltopia nesting. ' +
        'Partner collections must delegate mint freeze authority to the nesting authority before opening nests.',
      400,
      { code: 'incompatible_freeze_delegate' }
    )
  }

  const tokenAccount = new PublicKey(state.tokenAccount)
  const tx = new Transaction().add(
    createFreezeAccountInstruction(tokenAccount, new PublicKey(state.mint), authority.publicKey, [], TOKEN_PROGRAM_ID)
  )
  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  })

  return { signature, tokenAccount: state.tokenAccount }
}

export async function thawSplTokenNestAccount(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
  authority?: Keypair
}): Promise<{ signature: string | null; tokenAccount: string }> {
  const authority = params.authority ?? getNestingNftFreezeAuthorityKeypair()
  if (!authority) {
    throw new StakingUserError(
      'NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY is required for SPL nest unlock.',
      503
    )
  }

  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const state = await readSplTokenNestAccountState({
    mint: params.mint,
    ownerWallet: params.ownerWallet,
    connection,
  })

  if (!state.isFrozen) {
    return { signature: null, tokenAccount: state.tokenAccount }
  }

  if (!state.heldByNestingLock) {
    throw new StakingUserError(
      'This NFT has a freeze lock Owltopia cannot thaw automatically. Contact support.',
      503
    )
  }

  const tokenAccount = new PublicKey(state.tokenAccount)
  const tx = new Transaction().add(
    createThawAccountInstruction(tokenAccount, new PublicKey(state.mint), authority.publicKey, [], TOKEN_PROGRAM_ID)
  )
  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  })

  return { signature, tokenAccount: state.tokenAccount }
}

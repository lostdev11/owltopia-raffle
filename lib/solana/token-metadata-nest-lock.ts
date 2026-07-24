/**
 * Gen 2 / Metaplex Token Metadata nest locks via FreezeDelegatedAccount.
 *
 * Mint freeze authority sits on the Master Edition PDA (not a wallet), so SPL SetAuthority
 * cannot hand it to nesting. Holders Approve the nesting wallet as token delegate; the server
 * then FreezeDelegatedAccount / ThawDelegatedAccount with the nesting keypair.
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  findMasterEditionPda,
  freezeDelegatedAccount,
  mplTokenMetadata,
  thawDelegatedAccount,
} from '@metaplex-foundation/mpl-token-metadata'
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters'
import bs58 from 'bs58'
import { StakingUserError } from '@/lib/nesting/errors'
import { getNestingNftFreezeAuthorityKeypair } from '@/lib/nesting/freeze-authority-keypair'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import {
  readSplTokenNestAccountState,
  type SplTokenNestAccountState,
} from '@/lib/solana/spl-token-nest-lock'

/** Metaplex Token Metadata program — Master Edition accounts are owned by this. */
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
)

export type SplNestFreezePath = 'mint_freeze_authority' | 'freeze_delegated_account'

export async function detectSplNestFreezePath(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
}): Promise<{ path: SplNestFreezePath | null; state: SplTokenNestAccountState }> {
  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const state = await readSplTokenNestAccountState({
    mint: params.mint,
    ownerWallet: params.ownerWallet,
    connection,
  })

  if (state.nestingAuthorityCanFreeze) {
    return { path: 'mint_freeze_authority', state }
  }

  const fa = state.mintFreezeAuthority?.trim()
  if (!fa) {
    return { path: null, state }
  }

  try {
    const info = await connection.getAccountInfo(new PublicKey(fa))
    if (info?.owner.equals(TOKEN_METADATA_PROGRAM_ID)) {
      return { path: 'freeze_delegated_account', state }
    }
  } catch {
    // fall through
  }

  return { path: null, state }
}

function nestingKeypairOrThrow(): Keypair {
  const authority = getNestingNftFreezeAuthorityKeypair()
  if (!authority) {
    throw new StakingUserError(
      'NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY is required for Gen 2 nest locks.',
      503
    )
  }
  return authority
}

function createNestingUmi(authority: Keypair) {
  const umi = createUmi(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' }).use(
    mplTokenMetadata()
  )
  const signer = createSignerFromKeypair(umi, fromWeb3JsKeypair(authority))
  return umi.use(signerIdentity(signer))
}

function signatureToString(result: { signature?: Uint8Array | string } | Uint8Array | string): string {
  const sig =
    result && typeof result === 'object' && 'signature' in result ? result.signature : result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

/**
 * After the holder Approves nesting as SPL delegate, freeze the token account via Master Edition.
 */
export async function freezeTokenMetadataNestAccount(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
}): Promise<{ signature: string; tokenAccount: string }> {
  const authority = nestingKeypairOrThrow()
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

  if (!state.nestingIsTokenDelegate) {
    throw new StakingUserError(
      'Approve Owltopia nesting as the token delegate in your wallet first, then finish opening the nest.',
      400,
      { code: 'nest_relock_required' }
    )
  }

  const umi = createNestingUmi(authority)
  const mint = publicKey(state.mint)
  const tokenAccount = publicKey(state.tokenAccount)
  const edition = findMasterEditionPda(umi, { mint })
  const delegate = createSignerFromKeypair(umi, fromWeb3JsKeypair(authority))

  const result = await freezeDelegatedAccount(umi, {
    delegate,
    tokenAccount,
    mint,
    edition,
  }).sendAndConfirm(umi)

  return { signature: signatureToString(result), tokenAccount: state.tokenAccount }
}

/**
 * Thaw a FreezeDelegatedAccount nest lock. Delegate may remain until the holder revokes;
 * thawed NFTs are transferable either way.
 */
export async function thawTokenMetadataNestAccount(params: {
  mint: string
  ownerWallet: string
  connection?: Connection
}): Promise<{ signature: string | null; tokenAccount: string }> {
  const authority = nestingKeypairOrThrow()
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

  // Partner mint-authority path uses raw ThawAccount — caller should use thawSplTokenNestAccount.
  if (state.nestingAuthorityCanFreeze && !state.nestingIsTokenDelegate) {
    throw new StakingUserError(
      'Use SPL thaw for mint-authority nest locks.',
      500,
      { code: 'wrong_thaw_path' }
    )
  }

  const umi = createNestingUmi(authority)
  const mint = publicKey(state.mint)
  const tokenAccount = publicKey(state.tokenAccount)
  const edition = findMasterEditionPda(umi, { mint })
  const delegate = createSignerFromKeypair(umi, fromWeb3JsKeypair(authority))

  const result = await thawDelegatedAccount(umi, {
    delegate,
    tokenAccount,
    mint,
    edition,
  }).sendAndConfirm(umi)

  return { signature: signatureToString(result), tokenAccount: state.tokenAccount }
}

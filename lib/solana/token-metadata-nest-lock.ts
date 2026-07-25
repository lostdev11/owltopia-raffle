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
  readSplTokenNestAccountStatesBatch,
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

/**
 * Batched `detectSplNestFreezePath` for wallet-picker enrichment (Gen 2 / partner SPL perches):
 * token-account states via getMultipleAccounts, then one more batched read for the distinct
 * mint freeze authorities (Master Edition detection). Mints that could not be read are omitted —
 * callers should fall back to the per-mint path for those.
 */
export async function detectSplNestFreezePathsBatch(params: {
  mints: string[]
  ownerWallet: string
  connection?: Connection
}): Promise<Map<string, { path: SplNestFreezePath | null; state: SplTokenNestAccountState }>> {
  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })
  const out = new Map<string, { path: SplNestFreezePath | null; state: SplTokenNestAccountState }>()

  const states = await readSplTokenNestAccountStatesBatch({
    mints: params.mints,
    ownerWallet: params.ownerWallet,
    connection,
  })
  if (states.size === 0) return out

  // Resolve remaining paths from each mint's freeze authority (unique set, batched).
  const pendingFreezeAuthorities = new Map<string, PublicKey>()
  for (const [mint, state] of states) {
    if (state.nestingAuthorityCanFreeze) {
      out.set(mint, { path: 'mint_freeze_authority', state })
      continue
    }
    const fa = state.mintFreezeAuthority?.trim()
    if (!fa) {
      out.set(mint, { path: null, state })
      continue
    }
    if (!pendingFreezeAuthorities.has(fa)) pendingFreezeAuthorities.set(fa, new PublicKey(fa))
  }

  const tokenMetadataOwned = new Set<string>()
  const faReadFailed = new Set<string>()
  const faEntries = [...pendingFreezeAuthorities.entries()]
  const chunkSize = 100
  for (let i = 0; i < faEntries.length; i += chunkSize) {
    const chunk = faEntries.slice(i, i + chunkSize)
    try {
      const infos = await connection.getMultipleAccountsInfo(chunk.map(([, pk]) => pk))
      chunk.forEach(([fa], idx) => {
        if (infos[idx]?.owner.equals(TOKEN_METADATA_PROGRAM_ID)) tokenMetadataOwned.add(fa)
      })
    } catch {
      // Transient RPC failure — omit these mints so the per-mint fallback can retry them.
      for (const [fa] of chunk) faReadFailed.add(fa)
    }
  }

  for (const [mint, state] of states) {
    if (out.has(mint)) continue
    const fa = state.mintFreezeAuthority!.trim()
    if (faReadFailed.has(fa)) continue
    out.set(mint, {
      path: tokenMetadataOwned.has(fa) ? 'freeze_delegated_account' : null,
      state,
    })
  }

  return out
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

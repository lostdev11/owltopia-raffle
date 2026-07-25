import {
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  unpackAccount,
  unpackMint,
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
  /** True when the token account delegate is the nesting freeze authority. */
  nestingIsTokenDelegate: boolean
  heldByNestingLock: boolean
}

function nestingAuthorityPublicKey(): PublicKey | null {
  return getNestingNftFreezeAuthorityKeypair()?.publicKey ?? null
}

export function resolveSplTokenNestAta(mint: string, ownerWallet: string): PublicKey {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint.trim()),
    new PublicKey(ownerWallet.trim()),
    /** Token accounts owned by PDAs (rare) still resolve for diagnostics. */
    true,
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

  const nestingIsTokenDelegate =
    nestingPk != null && delegate != null && new PublicKey(delegate).equals(nestingPk)
  /**
   * Nesting holds the lock when:
   * - mint freeze authority is the nesting wallet (partner SPL freeze), or
   * - token account is frozen with nesting as SPL delegate (Metaplex FreezeDelegatedAccount / Gen 2).
   */
  const heldByNestingLock = isFrozen && (nestingAuthorityCanFreeze || nestingIsTokenDelegate)

  return {
    mint: mintPk.toBase58(),
    ownerWallet: ownerPk.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    isFrozen,
    mintFreezeAuthority,
    delegate,
    nestingAuthorityCanFreeze,
    nestingIsTokenDelegate,
    heldByNestingLock,
  }
}

/** Solana getMultipleAccounts caps at 100 keys per request. */
const MULTIPLE_ACCOUNTS_CHUNK = 100

async function getMultipleAccountsInfoChunked(
  connection: Connection,
  keys: PublicKey[]
): Promise<(Awaited<ReturnType<Connection['getAccountInfo']>> | null)[]> {
  const out: (Awaited<ReturnType<Connection['getAccountInfo']>> | null)[] = []
  for (let i = 0; i < keys.length; i += MULTIPLE_ACCOUNTS_CHUNK) {
    const chunk = keys.slice(i, i + MULTIPLE_ACCOUNTS_CHUNK)
    out.push(...(await connection.getMultipleAccountsInfo(chunk)))
  }
  return out
}

/**
 * Batched `readSplTokenNestAccountState` for wallet-picker enrichment: all mint accounts and
 * ATAs in a few getMultipleAccounts calls instead of 2 RPC round-trips per mint.
 * Mints whose accounts are missing or fail to decode are omitted — callers should fall back
 * to the per-mint read for those.
 */
export async function readSplTokenNestAccountStatesBatch(params: {
  mints: string[]
  ownerWallet: string
  connection?: Connection
}): Promise<Map<string, SplTokenNestAccountState>> {
  const out = new Map<string, SplTokenNestAccountState>()
  const ownerPk = new PublicKey(params.ownerWallet.trim())
  const nestingPk = nestingAuthorityPublicKey()
  const connection =
    params.connection ?? new Connection(resolveServerSolanaRpcUrl(), { commitment: 'confirmed' })

  const entries: Array<{ mint: string; mintPk: PublicKey; ata: PublicKey }> = []
  const seen = new Set<string>()
  for (const raw of params.mints) {
    const mint = raw.trim()
    if (!mint || seen.has(mint)) continue
    seen.add(mint)
    try {
      const mintPk = new PublicKey(mint)
      entries.push({ mint: mintPk.toBase58(), mintPk, ata: resolveSplTokenNestAta(mint, params.ownerWallet) })
    } catch {
      // Invalid pubkey — leave for the per-mint fallback to surface.
    }
  }
  if (entries.length === 0) return out

  const infos = await getMultipleAccountsInfoChunked(connection, [
    ...entries.map((e) => e.mintPk),
    ...entries.map((e) => e.ata),
  ])

  for (let i = 0; i < entries.length; i++) {
    const { mint, mintPk, ata } = entries[i]!
    const mintInfo = infos[i]
    const ataInfo = infos[entries.length + i]
    if (!mintInfo) continue

    try {
      const mintData = unpackMint(mintPk, mintInfo, TOKEN_PROGRAM_ID)
      const mintFreezeAuthority = mintData.freezeAuthority?.toBase58() ?? null
      const nestingAuthorityCanFreeze =
        nestingPk != null && mintData.freezeAuthority?.equals(nestingPk) === true

      let isFrozen = false
      let delegate: string | null = null
      if (ataInfo) {
        try {
          const acct = unpackAccount(ata, ataInfo, TOKEN_PROGRAM_ID)
          isFrozen = acct.isFrozen
          delegate = acct.delegate?.toBase58() ?? null
        } catch {
          // Undecodable ATA — same as missing: not frozen / not held.
        }
      }

      const nestingIsTokenDelegate =
        nestingPk != null && delegate != null && new PublicKey(delegate).equals(nestingPk)
      const heldByNestingLock = isFrozen && (nestingAuthorityCanFreeze || nestingIsTokenDelegate)

      out.set(mint, {
        mint,
        ownerWallet: ownerPk.toBase58(),
        tokenAccount: ata.toBase58(),
        isFrozen,
        mintFreezeAuthority,
        delegate,
        nestingAuthorityCanFreeze,
        nestingIsTokenDelegate,
        heldByNestingLock,
      })
    } catch {
      // Non-SPL / decode failure — leave for the per-mint fallback.
    }
  }

  return out
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

/**
 * Partner/admin public_simple mint via Metaplex Core Candy Machine `mintV1`.
 * Same wallet UX patterns as Gen2 TM mint (Phantom multi-signer, platform fee) without phased guards.
 */
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { Connection } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  generateSigner,
  isSome,
  publicKey,
  signAllTransactions,
  some,
  transactionBuilder,
  type Option,
  type Transaction,
  type TransactionBuilder,
} from '@metaplex-foundation/umi'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox'
import type { DefaultGuardSet, DefaultGuardSetMintArgs } from '@metaplex-foundation/mpl-core-candy-machine'

import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS } from '@/lib/owl-center/platform-mint-fee'
import {
  createMintSessionDeadline,
  MINT_RECOVERY_RESERVE_MS,
  MINT_SEND_MIN_MS,
  mintSessionRemainingMs,
  MintSessionTimeoutError,
  pauseMintSessionDeadline,
  resumeMintSessionDeadline,
  withMintSessionBudget,
  type MintSessionDeadline,
} from '@/lib/owl-center/mint-time-budget'
import { fetchCandyMachine, mintV1, safeFetchCandyGuard } from '@/lib/solana/core-candy-machine'
import {
  getLaunchCandyMachineId,
  getLaunchCollectionMint,
  getLaunchSolanaRpcUrl,
  resolveLaunchMintNetwork,
} from '@/lib/solana/launch-cm'
import type { OwlMintNetwork } from '@/lib/solana/network'
import {
  appendOwlCenterPlatformMintFeeSol,
  assertOwlCenterPlatformMintFeeSolBalance,
  resolveOwlCenterPlatformMintFeeLamports,
} from '@/lib/solana/owl-center-platform-mint-fee'
import {
  extractTxSignatureFromUnknownError,
  pollTransactionSignatureStatus,
} from '@/lib/solana/recover-candy-machine-mint'
import { friendlySolanaRpcErrorMessage, MINT_SOLANA_RPC_RETRY, MINT_SOLANA_SEND_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'
import { createOwlCenterCoreUmi } from '@/lib/solana/umi-core'
import { invalidLaunchMintIdReason, validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import { walletAdapterIsPhantom } from '@/lib/solana/phantom-sign-and-send-transaction'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'

/** mintV1 with Candy Guard comfortably fits in 800k CU (same ceiling as Gen2 mintV2). */
const MINT_COMPUTE_UNIT_LIMIT = 800_000

function mergeCoreGuardSets(defaults: DefaultGuardSet, group: DefaultGuardSet | null): DefaultGuardSet {
  if (!group) return defaults
  const merged: Record<string, Option<unknown>> = { ...(defaults as unknown as Record<string, Option<unknown>>) }
  for (const [key, value] of Object.entries(group as unknown as Record<string, Option<unknown>>)) {
    if (isSome(value)) merged[key] = value
  }
  return merged as unknown as DefaultGuardSet
}

function coreGuardMintArgs(guards: DefaultGuardSet): {
  mintArgs: Partial<DefaultGuardSetMintArgs> | undefined
  mintPriceLamports: bigint
} {
  const mintArgs: Partial<DefaultGuardSetMintArgs> = {}
  let mintPriceLamports = 0n
  if (isSome(guards.solPayment)) {
    mintArgs.solPayment = some({ destination: guards.solPayment.value.destination })
    mintPriceLamports += BigInt(guards.solPayment.value.lamports.basisPoints)
  }
  if (isSome(guards.mintLimit)) {
    mintArgs.mintLimit = some({ id: guards.mintLimit.value.id })
  }
  return {
    mintArgs: Object.keys(mintArgs).length > 0 ? mintArgs : undefined,
    mintPriceLamports,
  }
}

function mintPriorityFeeMicroLamports(): number {
  const raw = process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS?.trim()
  if (!raw) return 400_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 250_000
}

export type MintCoreCmParams = {
  walletAdapter: WalletAdapter
  candyMachineId: string
  collectionMint: string
  quantity: number
  launch?: Pick<
    OwlCenterLaunchPublic,
    | 'slug'
    | 'candy_machine_id'
    | 'collection_mint'
    | 'devnet_candy_machine_id'
    | 'devnet_collection_mint'
    | 'mint_mode'
    | 'mint_network'
  > | null
  mintNetwork?: OwlMintNetwork
  collectPlatformMintFee?: boolean
  platformFeeLamports?: bigint
  prefetchedWalletBalanceLamports?: bigint
  sessionDeadline?: MintSessionDeadline
  onMintProgress?: (current: number, total: number) => void
  /** Candy Guard group label (`wl` / `pub` / …). Null mints against default guards. */
  guardGroup?: string | null
}

export type MintCoreCmResult =
  | { ok: true; txSignatures: string[]; mintedNftMints: string[] }
  | {
      ok: false
      error: string
      txSignatures?: string[]
      mintedNftMints?: string[]
      plannedMintB58s?: string[]
    }

function resolveIds(params: MintCoreCmParams): { cmId: string; colMint: string; network: OwlMintNetwork } | { error: string } {
  const network =
    params.mintNetwork ??
    (params.launch ? resolveLaunchMintNetwork(params.launch) : 'mainnet')
  const cmId =
    params.candyMachineId.trim() ||
    (params.launch ? getLaunchCandyMachineId(params.launch, network) : '') ||
    ''
  const colMint =
    params.collectionMint.trim() ||
    (params.launch ? getLaunchCollectionMint(params.launch, network) : '') ||
    ''
  const invalid = invalidLaunchMintIdReason(cmId || null, colMint || null)
  if (invalid) return { error: invalid }
  const cmCheck = validateSolanaPubkeyInput(cmId, 'Candy Machine ID')
  if (!cmCheck.ok) return { error: cmCheck.error }
  const colCheck = validateSolanaPubkeyInput(colMint, 'Collection mint')
  if (!colCheck.ok) return { error: colCheck.error }
  return { cmId: cmCheck.pubkey, colMint: colCheck.pubkey, network }
}

export async function mintCoreFromCandyMachine(params: MintCoreCmParams): Promise<MintCoreCmResult> {
  const {
    walletAdapter,
    quantity,
    collectPlatformMintFee,
    platformFeeLamports: platformFeeLamportsOverride,
    prefetchedWalletBalanceLamports,
    sessionDeadline: sessionDeadlineParam,
    onMintProgress,
  } = params

  if (!walletAdapter.publicKey) return { ok: false, error: 'Wallet not connected' }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 25) {
    return { ok: false, error: 'Invalid quantity (max 25 per transaction)' }
  }

  const resolved = resolveIds(params)
  if ('error' in resolved) return { ok: false, error: resolved.error }
  const { cmId, colMint, network } = resolved

  try {
    const sessionDeadline = sessionDeadlineParam ?? createMintSessionDeadline()
    const rpcUrl = getLaunchSolanaRpcUrl(network)
    const umi = createOwlCenterCoreUmi(walletAdapter, rpcUrl)
    const candyMachine = publicKey(cmId)
    const collection = publicKey(colMint)
    const priorityFee = mintPriorityFeeMicroLamports()

    const [cmAccount, feeQuote] = await withMintSessionBudget(
      sessionDeadline,
      () =>
        Promise.all([
          withSolanaRpcRetry(() => fetchCandyMachine(umi, candyMachine), MINT_SOLANA_RPC_RETRY),
          collectPlatformMintFee
            ? platformFeeLamportsOverride != null && platformFeeLamportsOverride > 0n
              ? Promise.resolve({ ok: true as const, lamports: platformFeeLamportsOverride, solUsdPrice: 0 })
              : resolveOwlCenterPlatformMintFeeLamports()
            : Promise.resolve({ ok: true as const, lamports: 0n, solUsdPrice: 0 }),
        ]),
      'Mint setup timed out — refresh and tap Mint again.'
    )

    const remaining = Number(cmAccount.itemsLoaded) - Number(cmAccount.itemsRedeemed)
    if (remaining <= 0) {
      return {
        ok: false,
        error:
          'Sold out on-chain — no NFTs remain in the Candy Machine. Refresh the page; if the counter still looks wrong, contact support.',
      }
    }

    const candyGuardAccount = await withSolanaRpcRetry(
      () => safeFetchCandyGuard(umi, cmAccount.mintAuthority),
      MINT_SOLANA_RPC_RETRY
    )
    let groupLabel: string | null = params.guardGroup?.trim() || null
    let mergedGuards = candyGuardAccount?.guards ?? null
    if (candyGuardAccount && candyGuardAccount.groups.length > 0) {
      const wanted = groupLabel || 'pub'
      const group = candyGuardAccount.groups.find((g) => g.label === wanted)
      if (!group) {
        return {
          ok: false,
          error: `Mint group "${wanted}" is not on this Candy Guard (available: ${candyGuardAccount.groups.map((g) => g.label).join(', ')}).`,
        }
      }
      groupLabel = group.label
      mergedGuards = mergeCoreGuardSets(candyGuardAccount.guards, group.guards)
    } else {
      groupLabel = null
    }
    const { mintArgs, mintPriceLamports } = mergedGuards
      ? coreGuardMintArgs(mergedGuards)
      : { mintArgs: undefined, mintPriceLamports: 0n }

    let platformFeeLamports = 0n
    if (collectPlatformMintFee) {
      if (!feeQuote.ok) return { ok: false, error: feeQuote.error }
      platformFeeLamports = feeQuote.lamports
    }

    const walletB58 = walletAdapter.publicKey.toBase58()
    if (collectPlatformMintFee && platformFeeLamports > 0n) {
      const feeBal = await withSolanaRpcRetry(
        () =>
          assertOwlCenterPlatformMintFeeSolBalance(
            walletB58,
            network,
            platformFeeLamports,
            rpcUrl,
            quantity,
            prefetchedWalletBalanceLamports,
            mintPriceLamports
          ),
        MINT_SOLANA_RPC_RETRY
      )
      if (!feeBal.ok) return { ok: false, error: feeBal.error }
    } else if (prefetchedWalletBalanceLamports != null) {
      const needed = OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS * BigInt(quantity)
      if (prefetchedWalletBalanceLamports < needed) {
        return {
          ok: false,
          error: `Not enough SOL for mint rent and network fees (need ~${(Number(needed) / 1e9).toFixed(3)} SOL).`,
        }
      }
    }

    const assets = Array.from({ length: quantity }, () => generateSigner(umi))
    const plannedB58s = assets.map((a) => String(a.publicKey))

    const buildSingle = (asset: (typeof assets)[number]): { ok: true; builder: TransactionBuilder } | { ok: false; error: string } => {
      let builder = transactionBuilder().add(setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNIT_LIMIT }))
      if (priorityFee > 0) {
        builder = builder.add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      }
      if (collectPlatformMintFee && platformFeeLamports > 0n) {
        const feeRes = appendOwlCenterPlatformMintFeeSol(umi, platformFeeLamports, builder)
        if (!feeRes.ok) return feeRes
        builder = feeRes.builder
      }
      builder = builder.add(
        mintV1(umi, {
          candyMachine,
          asset,
          collection,
          ...(mintArgs ? { mintArgs } : {}),
          ...(groupLabel ? { group: groupLabel } : {}),
        })
      )
      return { ok: true, builder }
    }

    onMintProgress?.(quantity, quantity)
    pauseMintSessionDeadline(sessionDeadline)

    const usePhantomMultiSigner = walletAdapterIsPhantom(walletAdapter)
    const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

    if (usePhantomMultiSigner) {
      const blockhash = await withSolanaRpcRetry(
        () => umi.rpc.getLatestBlockhash({ commitment: 'confirmed' }),
        MINT_SOLANA_SEND_RETRY
      )
      const feePayer = walletAdapter.publicKey
      if (!feePayer) {
        resumeMintSessionDeadline(sessionDeadline)
        return { ok: false, error: 'Wallet not connected' }
      }

      const builtMints: Transaction[] = []
      for (let i = 0; i < quantity; i++) {
        const res = buildSingle(assets[i]!)
        if (!res.ok) {
          resumeMintSessionDeadline(sessionDeadline)
          return { ok: false, error: res.error, plannedMintB58s: plannedB58s }
        }
        builtMints.push(res.builder.setBlockhash(blockhash).build(umi))
      }

      for (const built of builtMints) {
        await assertTransactionSimulatesClean(connection, toWeb3JsTransaction(built), {
          failMessagePrefix: 'Mint would fail on-chain before wallet approval.',
        })
      }

      const walletSigned = await signAllTransactions(
        builtMints.map((transaction) => ({
          transaction,
          signers: [umi.identity],
        }))
      )

      const fullySigned: Transaction[] = []
      for (let i = 0; i < quantity; i++) {
        fullySigned.push(await assets[i]!.signTransaction(walletSigned[i]!))
      }

      resumeMintSessionDeadline(sessionDeadline)

      const confirmedSigs: string[] = []
      const confirmedMints: string[] = []
      let firstSendError: unknown = null

      for (let i = 0; i < quantity; i++) {
        try {
          const sigBytes = await withSolanaRpcRetry(
            () => umi.rpc.sendTransaction(fullySigned[i]!, { skipPreflight: false }),
            MINT_SOLANA_SEND_RETRY
          )
          const sig = typeof sigBytes === 'string' ? sigBytes : bs58.encode(sigBytes)
          const confirmMs = Math.max(
            MINT_SEND_MIN_MS,
            mintSessionRemainingMs(sessionDeadline) - MINT_RECOVERY_RESERVE_MS
          )
          const confirmed = await pollTransactionSignatureStatus(rpcUrl, sig, {
            maxWaitMs: confirmMs,
            intervalMs: 400,
            minCommitment: 'confirmed',
          })
          if (confirmed) {
            confirmedSigs.push(sig)
            confirmedMints.push(plannedB58s[i]!)
          }
        } catch (e) {
          firstSendError = firstSendError ?? e
          const sig = extractTxSignatureFromUnknownError(e)
          if (sig) {
            const confirmed = await pollTransactionSignatureStatus(rpcUrl, sig, {
              maxWaitMs: 4000,
              intervalMs: 400,
              minCommitment: 'confirmed',
            })
            if (confirmed) {
              confirmedSigs.push(sig)
              confirmedMints.push(plannedB58s[i]!)
            }
          }
        }
      }

      if (confirmedSigs.length === quantity) {
        return { ok: true, txSignatures: confirmedSigs, mintedNftMints: confirmedMints }
      }
      if (confirmedSigs.length > 0) {
        return {
          ok: false,
          error: `Minted ${confirmedSigs.length}/${quantity} — tap “My NFT minted” if the rest appear in your wallet.`,
          txSignatures: confirmedSigs,
          mintedNftMints: confirmedMints,
          plannedMintB58s: plannedB58s,
        }
      }
      return {
        ok: false,
        error: friendlySolanaRpcErrorMessage(firstSendError) || 'Mint failed',
        plannedMintB58s: plannedB58s,
      }
    }

    // Non-Phantom: Umi identity is the wallet — mintV1 includes the asset signer on the builder.
    resumeMintSessionDeadline(sessionDeadline)
    const confirmedSigs: string[] = []
    const confirmedMints: string[] = []

    for (let i = 0; i < quantity; i++) {
      const res = buildSingle(assets[i]!)
      if (!res.ok) {
        return {
          ok: false,
          error: res.error,
          txSignatures: confirmedSigs,
          mintedNftMints: confirmedMints,
          plannedMintB58s: plannedB58s,
        }
      }
      try {
        const result = await withSolanaRpcRetry(
          () => res.builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } }),
          MINT_SOLANA_SEND_RETRY
        )
        const sig =
          typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
        confirmedSigs.push(sig)
        confirmedMints.push(plannedB58s[i]!)
      } catch (e) {
        return {
          ok: false,
          error: friendlySolanaRpcErrorMessage(e) || (e instanceof Error ? e.message : String(e)),
          txSignatures: confirmedSigs,
          mintedNftMints: confirmedMints,
          plannedMintB58s: plannedB58s,
        }
      }
    }

    return { ok: true, txSignatures: confirmedSigs, mintedNftMints: confirmedMints }
  } catch (e) {
    if (e instanceof MintSessionTimeoutError) {
      return { ok: false, error: e.message }
    }
    return { ok: false, error: friendlySolanaRpcErrorMessage(e) || (e instanceof Error ? e.message : String(e)) }
  }
}

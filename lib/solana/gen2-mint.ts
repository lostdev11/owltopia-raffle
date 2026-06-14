import type { WalletAdapter } from '@solana/wallet-adapter-base'
import bs58 from 'bs58'
import { publicKey, generateSigner, transactionBuilder } from '@metaplex-foundation/umi'
import { fetchMetadata, findMetadataPda, findMasterEditionPda } from '@metaplex-foundation/mpl-token-metadata'
import { mintV2 } from '@metaplex-foundation/mpl-candy-machine'
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox'

import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { buildGen2GuardMintPlan, ensureGen2AllowListProof, isGen2MintablePhase } from '@/lib/solana/gen2-guards'
import { getLaunchCandyMachineId, getLaunchCollectionMint, getLaunchSolanaRpcUrl, resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { getGen2CandyMachineId, getGen2CollectionMint, getSolanaCluster, isDevnetMintEnabled, type OwlMintNetwork } from '@/lib/solana/network'
import { appendOwlCenterPlatformMintFeeSol, assertOwlCenterPlatformMintFeeSolBalance, resolveOwlCenterPlatformMintFeeLamports } from '@/lib/solana/owl-center-platform-mint-fee'
import { owlCenterPlatformMintFeeUsd } from '@/lib/owl-center/platform-mint-fee'
import { friendlySolanaRpcErrorMessage, MINT_SOLANA_RPC_RETRY, withSolanaRpcRetry } from '@/lib/solana/rpc-retry'
import { createOwlCenterUmi } from '@/lib/solana/umi'

/** mintV2 with guards comfortably fits in 800k CU (Metaplex-recommended ceiling). */
const MINT_COMPUTE_UNIT_LIMIT = 800_000

/**
 * Priority fee (micro-lamports per CU) for mainnet mint txs — at 800k CU the default
 * 100_000 adds 0.00008 SOL per mint. Set to 0 to disable.
 */
function mintPriorityFeeMicroLamports(): number {
  const raw = process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS?.trim()
  if (!raw) return 100_000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100_000
}

/** Optional DB-backed overrides (see `owl_center_launches` devnet columns). */
export type Gen2MintLaunchRefs = {
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
}

export type MintGen2Params = {
  walletAdapter: WalletAdapter
  candyMachineId: string
  collectionMint: string
  quantity: number
  phase: OwlCenterPhase
  /** When provided, resolves CM + collection from env + launch row (devnet vs mainnet). */
  launch?: Gen2MintLaunchRefs | null
  /** Override cluster for public_simple collections (independent of Gen2 devnet flag). */
  mintNetwork?: OwlMintNetwork
  /** When true, transfer Owltopia platform SOL fee to treasury in the same tx as each mint. */
  collectPlatformMintFee?: boolean
}

export type MintGen2Result =
  | {
      ok: true
      /** One signature per sequential mint (CM typically one NFT per tx). */
      txSignatures: string[]
      mintedNftMints: string[]
    }
  | { ok: false; error: string }

/**
 * Prepare + sign + confirm Candy Machine `mintV2` txs via Phantom / Solflare (wallet-standard adapter).
 *
 * Guard-aware: fetches the candy guard, selects the guard group for the active phase
 * (`gen1` / `pre` / `wl` / `pub` — see `lib/solana/gen2-guards.ts`), builds `mintArgs`
 * (solPayment destination, mintLimit id, allowList merkle root) and sends the allowList
 * `route` proof instruction first when the phase is merkle-gated.
 *
 * Required packages: see `lib/solana/umi.ts` / `candy-machine-v3.ts` header comments.
 *
 * TODO: Collection authority / delegate flows if CM uses a separate update authority.
 */
export async function mintGen2FromCandyMachine(params: MintGen2Params): Promise<MintGen2Result> {
  const { walletAdapter, candyMachineId, collectionMint, quantity, phase, launch, mintNetwork, collectPlatformMintFee } =
    params
  if (!walletAdapter.publicKey) {
    return { ok: false, error: 'Wallet not connected' }
  }
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 25) {
    return { ok: false, error: 'Invalid quantity (max 25 per transaction)' }
  }

  const network =
    mintNetwork ??
    (launch && 'mint_mode' in launch
      ? resolveLaunchMintNetwork(launch as Parameters<typeof resolveLaunchMintNetwork>[0])
      : isDevnetMintEnabled()
        ? 'devnet'
        : 'mainnet')

  if (network === 'devnet' && getSolanaCluster().toLowerCase() !== 'devnet' && !mintNetwork) {
    return {
      ok: false,
      error:
        'Wrong network / devnet required — use NEXT_PUBLIC_SOLANA_CLUSTER=devnet with NEXT_PUBLIC_GEN2_USE_DEVNET_MINT=true.',
    }
  }

  let cmId =
    candyMachineId.trim() ||
    (launch && 'mint_mode' in launch
      ? getLaunchCandyMachineId(launch as Parameters<typeof getLaunchCandyMachineId>[0], network)
      : getGen2CandyMachineId(launch ?? undefined))
  let colMint =
    collectionMint.trim() ||
    (launch && 'mint_mode' in launch
      ? getLaunchCollectionMint(launch as Parameters<typeof getLaunchCollectionMint>[0], network)
      : getGen2CollectionMint(launch ?? undefined))
  if (!cmId) {
    return { ok: false, error: 'Missing Candy Machine ID — set env or Owl Center admin devnet fields.' }
  }
  if (!colMint) {
    return { ok: false, error: 'Missing Collection Mint — set env or Owl Center admin devnet fields.' }
  }

  if (!isGen2MintablePhase(phase)) {
    return { ok: false, error: `Mint not available in phase ${phase}` }
  }

  try {
    const umi = createOwlCenterUmi(walletAdapter, getLaunchSolanaRpcUrl(network))
    const candyMachine = publicKey(cmId)
    const collectionMintPk = publicKey(colMint)
    const collectionMetadata = findMetadataPda(umi, { mint: collectionMintPk })
    const md = await withSolanaRpcRetry(() => fetchMetadata(umi, collectionMetadata), MINT_SOLANA_RPC_RETRY)
    const collectionUpdateAuthority = md.updateAuthority
    const collectionMasterEdition = findMasterEditionPda(umi, { mint: collectionMintPk })

    // Resolve guard group + mintArgs before asking the wallet for any signature.
    const planRes = await withSolanaRpcRetry(() => buildGen2GuardMintPlan(umi, candyMachine, phase), MINT_SOLANA_RPC_RETRY)
    if (!planRes.ok) {
      return { ok: false, error: planRes.error }
    }
    const plan = planRes.plan

    // Merkle-gated phase: create the allowList proof PDA once (route ix) before minting.
    if (plan.allowListMerkleRoot && plan.candyGuard) {
      const proofRes = await ensureGen2AllowListProof(umi, {
        candyMachine,
        candyGuard: plan.candyGuard.publicKey,
        groupLabel: plan.groupLabel,
        merkleRoot: plan.allowListMerkleRoot,
        phase,
      })
      if (!proofRes.ok) {
        return { ok: false, error: proofRes.error }
      }
    }

    const priorityFee = mintPriorityFeeMicroLamports()

    let platformFeeLamports = 0n
    if (collectPlatformMintFee) {
      const feeQuote = await resolveOwlCenterPlatformMintFeeLamports()
      if (!feeQuote.ok) {
        return { ok: false, error: feeQuote.error }
      }
      platformFeeLamports = feeQuote.lamports

      const walletB58 = walletAdapter.publicKey.toBase58()
      const feeBal = await withSolanaRpcRetry(
        () =>
          assertOwlCenterPlatformMintFeeSolBalance(
            walletB58,
            network,
            platformFeeLamports,
            getLaunchSolanaRpcUrl(network)
          ),
        MINT_SOLANA_RPC_RETRY
      )
      if (!feeBal.ok) {
        return { ok: false, error: feeBal.error }
      }
    }

    const txSignatures: string[] = []
    const mintedNftMints: string[] = []

    for (let i = 0; i < quantity; i++) {
      const nftMint = generateSigner(umi)
      let builder = transactionBuilder().add(setComputeUnitLimit(umi, { units: MINT_COMPUTE_UNIT_LIMIT }))
      if (priorityFee > 0) {
        builder = builder.add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      }
      if (collectPlatformMintFee && platformFeeLamports > 0n) {
        const feeRes = appendOwlCenterPlatformMintFeeSol(umi, platformFeeLamports, builder)
        if (!feeRes.ok) {
          return { ok: false, error: feeRes.error }
        }
        builder = feeRes.builder
      }
      builder = builder.add(
        mintV2(umi, {
          candyMachine,
          candyGuard: plan.candyGuard?.publicKey,
          nftMint,
          collectionMint: collectionMintPk,
          collectionUpdateAuthority,
          collectionMetadata,
          collectionMasterEdition,
          mintArgs: plan.mintArgs,
          ...(plan.groupLabel ? { group: plan.groupLabel } : {}),
        })
      )
      const res = await withSolanaRpcRetry(
        () => builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } }),
        MINT_SOLANA_RPC_RETRY
      )
      const sig = res.signature as string | Uint8Array
      const sigStr = typeof sig === 'string' ? sig : bs58.encode(sig)
      txSignatures.push(sigStr)
      mintedNftMints.push(String(nftMint.publicKey))
    }

    return { ok: true, txSignatures, mintedNftMints }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const low = msg.toLowerCase()
    if (low.includes('could not find candy machine') || low.includes('account does not exist')) {
      return { ok: false, error: 'Candy Machine fetch failed — check RPC cluster and Candy Machine ID.' }
    }
    if (low.includes('user rejected') || low.includes('cancel')) {
      return { ok: false, error: 'Mint transaction rejected in wallet' }
    }
    if (low.includes('notenoughsol') || low.includes('not enough sol')) {
      return { ok: false, error: 'Not enough SOL for the platform fee, NFT rent, and network fees.' }
    }
    if (low.includes('simulation failed') || low.includes('accountnotfound')) {
      const usd = owlCenterPlatformMintFeeUsd()
      return {
        ok: false,
        error: collectPlatformMintFee
          ? `Mint simulation failed — keep enough SOL for the ~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)} platform fee plus NFT rent (~0.02 SOL), then retry.`
          : 'Mint simulation failed — keep enough SOL for NFT rent and network fees (~0.02 SOL), then retry.',
      }
    }
    if (low.includes('missingallowedlistproof') || low.includes('addressnotfoundinallowedlist')) {
      return { ok: false, error: 'Wallet not validated on the on-chain allowlist for this phase.' }
    }
    const rpcHint = friendlySolanaRpcErrorMessage(e)
    if (rpcHint) {
      return { ok: false, error: rpcHint }
    }
    return { ok: false, error: msg }
  }
}

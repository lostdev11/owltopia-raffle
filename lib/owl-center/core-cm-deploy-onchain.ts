import 'server-only'

import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { createCollection, mplCore, ruleSet, updateCollectionPlugin } from '@metaplex-foundation/mpl-core'
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  signerIdentity,
  some,
  type Umi,
} from '@metaplex-foundation/umi'

import {
  publicSimpleCandyGuardUmiGroupsFromPlan,
  publicSimpleCandyGuardUmiGuardsFromPlan,
} from '@/lib/owl-center/sugar-public-simple-guards'
import { buildPublicSimpleGuardPlan } from '@/lib/owl-center/public-simple-guard-plan'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import { walletSplitsToMetaplexCreators } from '@/lib/owl-center/wallet-splits'
import {
  sugarConfigLineNameLength,
  sugarConfigLinePrefixName,
  type SugarDeployConfigLine,
} from '@/lib/owl-center/sugar-deploy-package'
import {
  addConfigLines,
  create,
  fetchCandyMachine,
  findCandyGuardPda,
  mplCoreCandyMachine,
} from '@/lib/solana/core-candy-machine'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  parseIrysDeployerSecretKeyForCore,
  type OnchainSugarDeployResult,
} from '@/lib/owl-center/sugar-deploy-onchain'
import {
  owlCenterCoreDeployLoadTimeBudgetMs,
  owlCenterCoreServerCmDeployMaxSupply,
} from '@/lib/owl-center/cm-deploy-limits'
import {
  isOwlCenterCreatorUaHandoffEnabled,
  handOffCoreCollectionUpdateAuthority,
} from '@/lib/owl-center/core-collection-ua-handoff'

const CONFIG_LINES_PER_TX = 10

export type OnchainCoreDeployInput = {
  launch: Pick<
    OwlCenterLaunchPublic,
    | 'name'
    | 'symbol'
    | 'total_supply'
    | 'creator_wallet'
    | 'royalty_splits'
    | 'mint_mode'
    | 'mint_network'
    | 'seller_fee_basis_points'
    | 'freeze_enabled'
    | 'wallet_mint_limit'
    | 'launch_deadline_at'
    | 'phase_schedule'
    | 'creator_wl_enabled'
    | 'creator_presale_enabled'
    | 'wl_supply'
    | 'presale_supply'
    | 'treasury_wallet'
    | 'public_price_usdc'
    | 'creator_mint_price'
    | 'creator_mint_currency'
    | 'partner_allowlist_phases'
    | 'wl_price_usdc'
  >
  configLines: SugarDeployConfigLine[]
  collectionMetadataUri: string
  collectionName: string
}

export type CoreConfigLineLoadResult =
  | {
      ok: true
      candyMachineId: string
      collectionMint: string
      candyGuardId: string
      configLinesLoaded: number
      configLinesTotal: number
      complete: boolean
    }
  | { ok: false; error: string }

function maxUriLength(lines: SugarDeployConfigLine[]): number {
  return Math.max(32, ...lines.map((l) => l.uri.length))
}

function maxNameLength(lines: SugarDeployConfigLine[]): number {
  return sugarConfigLineNameLength(lines)
}

export function createIrysDeployerCoreUmi(network: 'mainnet' | 'devnet'): Umi {
  const rpc =
    network === 'devnet'
      ? process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
        process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim() ||
        'https://api.devnet.solana.com'
      : resolveServerSolanaRpcUrl()

  const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCore()).use(mplCoreCandyMachine())
  const secret = parseIrysDeployerSecretKeyForCore()
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  const signer = createSignerFromKeypair(umi, kp)
  umi.use(signerIdentity(signer))
  return umi
}

function resolveCreatorAddress(
  umi: Umi,
  launch: OnchainCoreDeployInput['launch']
): { ok: true; creatorAddress: ReturnType<typeof publicKey> } | { ok: false; error: string } {
  const handoffEnabled = isOwlCenterCreatorUaHandoffEnabled()
  let creatorAddress = umi.identity.publicKey
  const creatorWallet = launch.creator_wallet?.trim()
  if (handoffEnabled) {
    if (!creatorWallet) {
      return {
        ok: false,
        error: 'creator_wallet is required for Core deploys so update authority can be handed to the creator.',
      }
    }
    const creatorCheck = validateSolanaPubkeyInput(creatorWallet, 'Creator wallet')
    if (!creatorCheck.ok) {
      return {
        ok: false,
        error: `${creatorCheck.error} Fix creator_wallet on the launch before deploying.`,
      }
    }
    creatorAddress = publicKey(creatorCheck.pubkey)
  } else if (creatorWallet) {
    const creatorCheck = validateSolanaPubkeyInput(creatorWallet, 'Creator wallet')
    if (!creatorCheck.ok) {
      return {
        ok: false,
        error: `${creatorCheck.error} Fix creator_wallet on the launch, or clear it to use the deployer wallet.`,
      }
    }
    creatorAddress = publicKey(creatorCheck.pubkey)
  }
  return { ok: true, creatorAddress }
}

/**
 * Create Core collection + Core Candy Machine (empty items). Caller loads config lines via
 * `loadCoreCandyMachineConfigLines` (resumable for large supply).
 */
export async function createPublicSimpleCoreCandyMachineShell(
  input: OnchainCoreDeployInput
): Promise<
  | {
      ok: true
      candyMachineId: string
      collectionMint: string
      candyGuardId: string
      configLinesTotal: number
    }
  | { ok: false; error: string }
> {
  const { launch, configLines, collectionMetadataUri, collectionName } = input
  if (configLines.length === 0) {
    return { ok: false, error: 'No token metadata URIs in upload job — complete Arweave push first.' }
  }
  const maxSupply = owlCenterCoreServerCmDeployMaxSupply()
  if (configLines.length > maxSupply) {
    return {
      ok: false,
      error: `Supply ${configLines.length} exceeds Core server deploy ceiling (${maxSupply}). Contact ops or lower OWL_CENTER_CORE_SERVER_CM_DEPLOY_MAX_SUPPLY.`,
    }
  }
  if (!collectionMetadataUri.trim()) {
    return { ok: false, error: 'Missing collection metadata URI (assets/collection.json on Arweave).' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerCoreUmi(network)
  const supply = configLines.length
  const royaltyBps = launchSellerFeeBasisPoints(launch)
  const handoffEnabled = isOwlCenterCreatorUaHandoffEnabled()

  const creatorResolved = resolveCreatorAddress(umi, launch)
  if (!creatorResolved.ok) return creatorResolved
  const { creatorAddress } = creatorResolved

  const creators = walletSplitsToMetaplexCreators(launch.royalty_splits, String(creatorAddress)).map((row) => ({
    address: publicKey(row.address),
    percentage: row.share,
  }))

  const collection = generateSigner(umi)
  const candyMachine = generateSigner(umi)

  const plugins: Parameters<typeof createCollection>[1]['plugins'] = [
    {
      type: 'Royalties',
      basisPoints: royaltyBps,
      creators,
      ruleSet: ruleSet('None'),
    },
  ]
  if (handoffEnabled) {
    // Keep IRYS as UpdateDelegate before transferring root UA to the creator.
    plugins.push({
      type: 'UpdateDelegate',
      additionalDelegates: [umi.identity.publicKey],
    })
  }
  if (launch.freeze_enabled) {
    plugins.push({
      type: 'PermanentFreezeDelegate',
      frozen: true,
      authority: { type: 'Address', address: umi.identity.publicKey },
    })
  }

  try {
    await createCollection(umi, {
      collection,
      name: collectionName.slice(0, 32) || 'Collection',
      uri: collectionMetadataUri,
      plugins,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    const planned = await buildPublicSimpleGuardPlan(launch)
    if (!planned.ok) return { ok: false, error: planned.error }

    const createIx = await create(umi, {
      candyMachine,
      collection: collection.publicKey,
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: supply,
      isMutable: true,
      configLineSettings: some({
        prefixName: sugarConfigLinePrefixName(collectionName, maxNameLength(configLines)),
        nameLength: maxNameLength(configLines),
        prefixUri: '',
        uriLength: maxUriLength(configLines),
        isSequential: false,
      }),
      guards: publicSimpleCandyGuardUmiGuardsFromPlan(planned.plan),
      groups: publicSimpleCandyGuardUmiGroupsFromPlan(planned.plan),
    })
    await createIx.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    const candyGuard = findCandyGuardPda(umi, { base: candyMachine.publicKey })
    return {
      ok: true,
      candyMachineId: String(candyMachine.publicKey),
      collectionMint: String(collection.publicKey),
      candyGuardId: String(candyGuard),
      configLinesTotal: supply,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('insufficient')) {
      return { ok: false, error: 'Deployer wallet needs more SOL for Core Candy Machine rent and fees.' }
    }
    return { ok: false, error: msg }
  }
}

/**
 * Append config lines to an existing Core CM, respecting a wall-clock budget so large
 * supplies (e.g. 1010) can finish across multiple HTTP invocations under maxDuration=300.
 */
export async function loadCoreCandyMachineConfigLines(params: {
  network: 'mainnet' | 'devnet'
  candyMachineId: string
  collectionMint: string
  candyGuardId: string
  configLines: SugarDeployConfigLine[]
  /** Preferred start index from checkpoint; overridden by on-chain itemsLoaded when higher. */
  startIndex?: number
  timeBudgetMs?: number
}): Promise<CoreConfigLineLoadResult> {
  const {
    network,
    candyMachineId,
    collectionMint,
    candyGuardId,
    configLines,
    startIndex: preferredStart = 0,
    timeBudgetMs = owlCenterCoreDeployLoadTimeBudgetMs(),
  } = params

  if (configLines.length === 0) {
    return { ok: false, error: 'No config lines to load.' }
  }

  const cmCheck = validateSolanaPubkeyInput(candyMachineId, 'Candy Machine ID')
  if (!cmCheck.ok) return { ok: false, error: cmCheck.error }

  try {
    const umi = createIrysDeployerCoreUmi(network)
    const cmPk = publicKey(cmCheck.pubkey)
    const cm = await fetchCandyMachine(umi, cmPk)
    const onChainLoaded = Number(cm.itemsLoaded)
    let index = Math.max(0, Math.floor(preferredStart), onChainLoaded)
    const total = configLines.length

    if (index > total) {
      return {
        ok: false,
        error: `On-chain itemsLoaded (${index}) exceeds package supply (${total}).`,
      }
    }

    if (index >= total) {
      return {
        ok: true,
        candyMachineId,
        collectionMint,
        candyGuardId,
        configLinesLoaded: total,
        configLinesTotal: total,
        complete: true,
      }
    }

    const deadline = Date.now() + Math.max(5_000, timeBudgetMs)

    while (index < total) {
      if (Date.now() >= deadline) {
        return {
          ok: true,
          candyMachineId,
          collectionMint,
          candyGuardId,
          configLinesLoaded: index,
          configLinesTotal: total,
          complete: false,
        }
      }

      const chunk = configLines.slice(index, index + CONFIG_LINES_PER_TX)
      await addConfigLines(umi, {
        candyMachine: cmPk,
        index,
        configLines: chunk,
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
      index += chunk.length
    }

    return {
      ok: true,
      candyMachineId,
      collectionMint,
      candyGuardId,
      configLinesLoaded: total,
      configLinesTotal: total,
      complete: true,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('insufficient')) {
      return { ok: false, error: 'Deployer wallet needs more SOL for Core Candy Machine rent and fees.' }
    }
    return { ok: false, error: msg }
  }
}

export async function finishCoreDeployAuthorityHandoff(params: {
  network: 'mainnet' | 'devnet'
  collectionMint: string
  candyMachineId: string
  candyGuardId: string
  creatorWallet: string
}): Promise<OnchainSugarDeployResult> {
  const umi = createIrysDeployerCoreUmi(params.network)
  const handoff = await handOffCoreCollectionUpdateAuthority({
    umi,
    collectionAddress: params.collectionMint,
    creatorWallet: params.creatorWallet,
  })
  if (!handoff.ok) {
    return {
      ok: false,
      error: handoff.error,
      partial: {
        candyMachineId: params.candyMachineId,
        collectionMint: params.collectionMint,
        candyGuardId: params.candyGuardId,
        phase: 'cm_ready',
      },
    }
  }
  return {
    ok: true,
    candyMachineId: params.candyMachineId,
    collectionMint: params.collectionMint,
    candyGuardId: params.candyGuardId,
    onchainUpdateAuthority: handoff.updateAuthority,
    platformUpdateDelegate: handoff.platformDelegate,
    uaHandoffPhase: 'ua_handed_off',
  }
}

/**
 * Deploy Core collection + Core Candy Machine with botTax, per-wallet mintLimit, and optional startDate.
 * Optional PermanentFreezeDelegate when freeze_enabled (thaw authority = deployer).
 *
 * For large supplies, prefer the worker's multi-step flow (create → load → handoff). This one-shot
 * helper still exists for small collections and tests; it loads all lines in one call with the
 * standard time budget and may return incomplete if the budget elapses (caller should resume).
 */
export async function deployPublicSimpleCoreCandyMachineOnchain(
  input: OnchainCoreDeployInput
): Promise<OnchainSugarDeployResult & { configLinesLoaded?: number; configLinesTotal?: number; needsContinue?: boolean }> {
  const created = await createPublicSimpleCoreCandyMachineShell(input)
  if (!created.ok) return created

  const network = resolveLaunchMintNetwork(input.launch)
  const loaded = await loadCoreCandyMachineConfigLines({
    network,
    candyMachineId: created.candyMachineId,
    collectionMint: created.collectionMint,
    candyGuardId: created.candyGuardId,
    configLines: input.configLines,
    startIndex: 0,
  })
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      partial: {
        candyMachineId: created.candyMachineId,
        collectionMint: created.collectionMint,
        candyGuardId: created.candyGuardId,
        phase: 'cm_ready',
      },
    }
  }

  if (!loaded.complete) {
    return {
      ok: false,
      error: `Config lines partially loaded (${loaded.configLinesLoaded}/${loaded.configLinesTotal}). Continue deploy to finish.`,
      partial: {
        candyMachineId: loaded.candyMachineId,
        collectionMint: loaded.collectionMint,
        candyGuardId: loaded.candyGuardId,
        phase: 'cm_ready',
      },
      configLinesLoaded: loaded.configLinesLoaded,
      configLinesTotal: loaded.configLinesTotal,
      needsContinue: true,
    }
  }

  const handoffEnabled = isOwlCenterCreatorUaHandoffEnabled()
  if (!handoffEnabled) {
    return {
      ok: true,
      candyMachineId: loaded.candyMachineId,
      collectionMint: loaded.collectionMint,
      candyGuardId: loaded.candyGuardId,
      onchainUpdateAuthority: null,
      platformUpdateDelegate: null,
      uaHandoffPhase: 'skipped',
      configLinesLoaded: loaded.configLinesLoaded,
      configLinesTotal: loaded.configLinesTotal,
    }
  }

  const creatorWallet = input.launch.creator_wallet?.trim()
  if (!creatorWallet) {
    return {
      ok: false,
      error: 'creator_wallet is required for Core deploys so update authority can be handed to the creator.',
      partial: {
        candyMachineId: loaded.candyMachineId,
        collectionMint: loaded.collectionMint,
        candyGuardId: loaded.candyGuardId,
        phase: 'cm_ready',
      },
    }
  }

  return finishCoreDeployAuthorityHandoff({
    network,
    collectionMint: loaded.collectionMint,
    candyMachineId: loaded.candyMachineId,
    candyGuardId: loaded.candyGuardId,
    creatorWallet,
  })
}

/** Thaw a Core collection PermanentFreezeDelegate (one tx unlocks all members). */
export async function thawCoreCollectionPermanentFreeze(params: {
  collectionAddress: string
  network: 'mainnet' | 'devnet'
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  try {
    const umi = createIrysDeployerCoreUmi(params.network)
    const collection = publicKey(params.collectionAddress)
    const builder = updateCollectionPlugin(umi, {
      collection,
      plugin: {
        type: 'PermanentFreezeDelegate',
        frozen: false,
      },
    })
    const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    const signature =
      typeof result.signature === 'string' ? result.signature : bs58.encode(result.signature)
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

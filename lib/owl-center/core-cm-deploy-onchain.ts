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

import { publicSimpleCandyGuardUmiGuards, publicSimpleGuardOptsFromLaunch } from '@/lib/owl-center/sugar-public-simple-guards'
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
  findCandyGuardPda,
  mplCoreCandyMachine,
} from '@/lib/solana/core-candy-machine'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import {
  OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY,
  parseIrysDeployerSecretKeyForCore,
  type OnchainSugarDeployResult,
} from '@/lib/owl-center/sugar-deploy-onchain'

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
  >
  configLines: SugarDeployConfigLine[]
  collectionMetadataUri: string
  collectionName: string
}

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

/**
 * Deploy Core collection + Core Candy Machine with botTax, per-wallet mintLimit, and optional startDate.
 * Optional PermanentFreezeDelegate when freeze_enabled (thaw authority = deployer).
 */
export async function deployPublicSimpleCoreCandyMachineOnchain(
  input: OnchainCoreDeployInput
): Promise<OnchainSugarDeployResult> {
  const { launch, configLines, collectionMetadataUri, collectionName } = input
  if (configLines.length === 0) {
    return { ok: false, error: 'No token metadata URIs in upload job — complete Arweave push first.' }
  }
  if (configLines.length > OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY) {
    return {
      ok: false,
      error: `Supply ${configLines.length} exceeds server deploy cap (${OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY}).`,
    }
  }
  if (!collectionMetadataUri.trim()) {
    return { ok: false, error: 'Missing collection metadata URI (assets/collection.json on Arweave).' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerCoreUmi(network)
  const supply = configLines.length
  const royaltyBps = launchSellerFeeBasisPoints(launch)

  let creatorAddress = umi.identity.publicKey
  const creatorWallet = launch.creator_wallet?.trim()
  if (creatorWallet) {
    const creatorCheck = validateSolanaPubkeyInput(creatorWallet, 'Creator wallet')
    if (!creatorCheck.ok) {
      return {
        ok: false,
        error: `${creatorCheck.error} Fix creator_wallet on the launch, or clear it to use the deployer wallet.`,
      }
    }
    creatorAddress = publicKey(creatorCheck.pubkey)
  }

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
      guards: publicSimpleCandyGuardUmiGuards(publicSimpleGuardOptsFromLaunch(launch)),
    })
    await createIx.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    for (let i = 0; i < configLines.length; i += CONFIG_LINES_PER_TX) {
      const chunk = configLines.slice(i, i + CONFIG_LINES_PER_TX)
      await addConfigLines(umi, {
        candyMachine: candyMachine.publicKey,
        index: i,
        configLines: chunk,
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    }

    const candyGuard = findCandyGuardPda(umi, { base: candyMachine.publicKey })

    return {
      ok: true,
      candyMachineId: String(candyMachine.publicKey),
      collectionMint: String(collection.publicKey),
      candyGuardId: String(candyGuard),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('insufficient')) {
      return { ok: false, error: 'Deployer wallet needs more SOL for Core Candy Machine rent and fees.' }
    }
    return { ok: false, error: msg }
  }
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

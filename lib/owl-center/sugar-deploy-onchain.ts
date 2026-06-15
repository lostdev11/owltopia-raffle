import 'server-only'

import bs58 from 'bs58'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  addConfigLines,
  createCandyGuard,
  createCandyMachineV2,
  findCandyGuardPda,
  wrap,
} from '@metaplex-foundation/mpl-candy-machine'
import { collectionDetails, createNft, TokenStandard } from '@metaplex-foundation/mpl-token-metadata'
import {
  createSignerFromKeypair,
  generateSigner,
  none,
  percentAmount,
  publicKey,
  signerIdentity,
  sol,
  some,
  type Umi,
} from '@metaplex-foundation/umi'
import { mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine'
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'

import { publicSimpleCandyGuardGuards } from '@/lib/owl-center/sugar-public-simple-guards'
import { launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import {
  sugarConfigLineNameLength,
  sugarConfigLinePrefixName,
  type SugarDeployConfigLine,
} from '@/lib/owl-center/sugar-deploy-package'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { validateSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

const CONFIG_LINES_PER_TX = 10
/** Server deploy cap — large collections should use Sugar CLI locally. */
export const OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY = 250

export type OnchainSugarDeployInput = {
  launch: Pick<
    OwlCenterLaunchPublic,
    'name' | 'symbol' | 'total_supply' | 'creator_wallet' | 'mint_mode' | 'mint_network' | 'seller_fee_basis_points'
  >
  configLines: SugarDeployConfigLine[]
  collectionMetadataUri: string
  collectionName: string
}

export type OnchainSugarDeployResult =
  | {
      ok: true
      candyMachineId: string
      collectionMint: string
      candyGuardId: string
    }
  | { ok: false; error: string }

function parseIrysDeployerSecretKey(): Uint8Array {
  const raw = process.env.IRYS_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('IRYS_PRIVATE_KEY is not configured')
  try {
    return bs58.decode(raw)
  } catch {
    return Uint8Array.from(JSON.parse(raw) as number[])
  }
}

export function isOwlCenterOnchainCmDeployEnabled(): boolean {
  if (process.env.OWL_CENTER_ONCHAIN_CM_DEPLOY === 'false') return false
  return Boolean(process.env.IRYS_PRIVATE_KEY?.trim())
}

export function createIrysDeployerUmi(network: 'mainnet' | 'devnet'): Umi {
  const rpc =
    network === 'devnet'
      ? process.env.SOLANA_RPC_DEVNET_URL?.trim() ||
        process.env.NEXT_PUBLIC_DEV_SOLANA_RPC_URL?.trim() ||
        'https://api.devnet.solana.com'
      : resolveServerSolanaRpcUrl()

  const umi = createUmi(rpc, { commitment: 'confirmed' }).use(mplCandyMachine()).use(mplTokenMetadata())
  const secret = parseIrysDeployerSecretKey()
  const kp = umi.eddsa.createKeypairFromSecretKey(secret)
  const signer = createSignerFromKeypair(umi, kp)
  umi.use(signerIdentity(signer))
  return umi
}

function maxUriLength(lines: SugarDeployConfigLine[]): number {
  return Math.max(32, ...lines.map((l) => l.uri.length))
}

function maxNameLength(lines: SugarDeployConfigLine[]): number {
  return sugarConfigLineNameLength(lines)
}

export async function deployPublicSimpleCandyMachineOnchain(
  input: OnchainSugarDeployInput
): Promise<OnchainSugarDeployResult> {
  const { launch, configLines, collectionMetadataUri, collectionName } = input
  if (configLines.length === 0) {
    return { ok: false, error: 'No token metadata URIs in upload job — complete Arweave push first.' }
  }
  if (configLines.length > OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY) {
    return {
      ok: false,
      error: `Supply ${configLines.length} exceeds server deploy cap (${OWL_CENTER_SERVER_CM_DEPLOY_MAX_SUPPLY}). Use npm run sugar:deploy locally.`,
    }
  }
  if (!collectionMetadataUri.trim()) {
    return { ok: false, error: 'Missing collection metadata URI (assets/collection.json on Arweave).' }
  }

  const network = resolveLaunchMintNetwork(launch)
  const umi = createIrysDeployerUmi(network)
  const supply = configLines.length
  const royaltyPercent = launchSellerFeeBasisPoints(launch) / 100

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

  const candyMachine = generateSigner(umi)
  const collectionMint = generateSigner(umi)
  const guardBase = generateSigner(umi)

  try {
    await createNft(umi, {
      mint: collectionMint,
      name: collectionName.slice(0, 32) || 'Collection',
      uri: collectionMetadataUri,
      sellerFeeBasisPoints: percentAmount(royaltyPercent),
      symbol: (launch.symbol ?? 'COL').slice(0, 10),
      isCollection: true,
      collectionDetails: collectionDetails('V1', { size: supply }),
      creators: [{ address: creatorAddress, share: 100, verified: false }],
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    const createCm = await createCandyMachineV2(umi, {
      candyMachine,
      collectionMint: collectionMint.publicKey,
      collectionUpdateAuthority: umi.identity,
      tokenStandard: TokenStandard.NonFungible,
      itemsAvailable: supply,
      symbol: (launch.symbol ?? 'COL').slice(0, 10),
      sellerFeeBasisPoints: percentAmount(royaltyPercent),
      maxEditionSupply: 0,
      isMutable: true,
      creators: [{ address: creatorAddress, percentageShare: 100, verified: false }],
      configLineSettings: some({
        prefixName: sugarConfigLinePrefixName(collectionName, maxNameLength(configLines)),
        nameLength: maxNameLength(configLines),
        prefixUri: '',
        uriLength: maxUriLength(configLines),
        isSequential: false,
      }),
      hiddenSettings: none(),
    })
    await createCm.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    for (let i = 0; i < configLines.length; i += CONFIG_LINES_PER_TX) {
      const chunk = configLines.slice(i, i + CONFIG_LINES_PER_TX)
      await addConfigLines(umi, {
        candyMachine: candyMachine.publicKey,
        index: i,
        configLines: chunk,
      }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })
    }

    const botTax = publicSimpleCandyGuardGuards().botTax
    await createCandyGuard(umi, {
      base: guardBase,
      guards: {
        botTax: some({ lamports: sol(0.001), lastInstruction: botTax.lastInstruction }),
      },
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    const candyGuard = findCandyGuardPda(umi, { base: guardBase.publicKey })
    await wrap(umi, {
      candyGuard,
      candyMachine: candyMachine.publicKey,
      candyMachineAuthority: umi.identity,
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } })

    return {
      ok: true,
      candyMachineId: String(candyMachine.publicKey),
      collectionMint: String(collectionMint.publicKey),
      candyGuardId: String(candyGuard),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('insufficient')) {
      return { ok: false, error: 'Deployer wallet needs more SOL for Candy Machine + guard rent and fees.' }
    }
    return { ok: false, error: msg }
  }
}

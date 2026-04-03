/**
 * Bubblegum leaf transfer: V2 trees require `transferV2` with MPL account compression + MPL noop.
 * V1 trees use `transfer` with SPL compression + SPL noop (see getCompressionProgramsForV1Ixs).
 */
import {
  fetchTreeConfigFromSeeds,
  getCompressionProgramsForV1Ixs,
  transfer as bubblegumTransfer,
  transferV2 as bubblegumTransferV2,
  Version,
} from '@metaplex-foundation/mpl-bubblegum'
import { none, some } from '@metaplex-foundation/umi'

export async function buildBubblegumLeafTransferBuilder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  umi: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authoritySigner: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  leafOwner: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newLeafOwner: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asset: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const treeCfg = await fetchTreeConfigFromSeeds(umi, { merkleTree: asset.merkleTree })

  if (treeCfg.version === Version.V2) {
    const assetDataHash =
      asset.asset_data_hash instanceof Uint8Array && asset.asset_data_hash.length === 32
        ? some(asset.asset_data_hash)
        : none()
    const flags =
      typeof asset.flags === 'number' && !Number.isNaN(asset.flags) ? some(asset.flags) : none()

    return bubblegumTransferV2(umi, {
      authority: authoritySigner,
      payer: authoritySigner,
      leafOwner,
      leafDelegate: asset.leafDelegate,
      newLeafOwner,
      merkleTree: asset.merkleTree,
      root: asset.root,
      dataHash: asset.dataHash,
      creatorHash: asset.creatorHash,
      nonce: BigInt(asset.nonce),
      index: asset.index,
      proof: asset.proof,
      assetDataHash,
      flags,
    })
  }

  const { compressionProgram, logWrapper } = await getCompressionProgramsForV1Ixs(umi)
  return bubblegumTransfer(umi, {
    leafOwner,
    leafDelegate: asset.leafDelegate,
    newLeafOwner,
    merkleTree: asset.merkleTree,
    root: asset.root,
    dataHash: asset.dataHash,
    creatorHash: asset.creatorHash,
    nonce: BigInt(asset.nonce),
    index: asset.index,
    proof: asset.proof,
    compressionProgram,
    logWrapper,
  })
}

import type { GeneratedNft, GeneratorProject } from '@/lib/owl-center/generator/types'

/** OpenSea ERC-721 token metadata (https://docs.opensea.io/docs/media-and-traits). */
export type OpenSeaTokenMetadata = {
  name: string
  description: string
  image: string
  attributes: { trait_type: string; value: string }[]
}

export type OpenSeaMetadataOptions = {
  /**
   * Hosted base URI for images + metadata (no trailing slash).
   * Example: `ipfs://bafy...` or `https://cdn.example.com/my-collection`
   * When omitted, image uses a replaceable placeholder path.
   */
  baseUri?: string
}

export const OPENSEA_IMAGE_PLACEHOLDER = '__REPLACE_BASE_URI__'

/** Resolve the `image` field OpenSea expects for a token PNG. */
export function openSeaImageUri(index: number, baseUri?: string): string {
  const path = `images/${index}.png`
  const trimmed = baseUri?.trim().replace(/\/+$/, '')
  if (!trimmed) return `${OPENSEA_IMAGE_PLACEHOLDER}/${path}`
  return `${trimmed}/${path}`
}

export function buildOpenSeaTokenMetadata(
  project: GeneratorProject,
  nft: GeneratedNft,
  options?: OpenSeaMetadataOptions
): OpenSeaTokenMetadata {
  const { collectionName, description } = project
  return {
    name: `${collectionName} #${nft.index}`,
    description: `${description} Token ${nft.index}.`.trim(),
    image: openSeaImageUri(nft.index, options?.baseUri),
    attributes: nft.attributes.map((attr) => ({
      trait_type: attr.trait_type,
      value: attr.value,
    })),
  }
}

export function serializeOpenSeaTokenMetadata(
  project: GeneratorProject,
  nft: GeneratedNft,
  options?: OpenSeaMetadataOptions
): string {
  return JSON.stringify(buildOpenSeaTokenMetadata(project, nft, options), null, 2)
}

export const OPENSEA_EXPORT_README = `OpenSea-compatible metadata export
=================================

This ZIP follows OpenSea's ERC-721 metadata shape:
https://docs.opensea.io/docs/metadata-standards

Folder layout:
  images/     PNG artwork (one per token)
  metadata/   JSON per token (name, description, image, attributes)
  traits.csv  Spreadsheet of trait columns per index

Before minting on Robinhood Chain (or any EVM chain):
1. Upload the images/ folder to IPFS, Arweave, or HTTPS hosting.
2. Set each metadata/*.json "image" field to the full URI of that PNG
   (ipfs://, https://, or ar:// — see https://docs.opensea.io/docs/metadata-storage).
3. Upload metadata JSON and point your ERC-721 tokenURI at those files.
4. Mint on-chain; OpenSea indexes the contract automatically.

Tip: re-export from Owl Generator with a "Hosted base URI" filled in to bake
full image URIs into metadata (e.g. ipfs://bafy... after you know the CID).
`

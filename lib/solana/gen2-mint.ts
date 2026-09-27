/**
 * Gen2 collection entrypoint — thin aliases over the shared Token Metadata Candy Machine mint.
 * Prefer importing from `@/lib/solana/token-metadata-cm-mint` for partner / non-Gen2 launches.
 */
export {
  mintTokenMetadataFromCandyMachine as mintGen2FromCandyMachine,
  warmTokenMetadataMintPrep as warmGen2MintPrep,
  type MintTokenMetadataParams as MintGen2Params,
  type MintTokenMetadataResult as MintGen2Result,
  type TokenMetadataMintLaunchRefs as Gen2MintLaunchRefs,
  mintTokenMetadataFromCandyMachine,
  warmTokenMetadataMintPrep,
  type MintTokenMetadataParams,
  type MintTokenMetadataResult,
  type TokenMetadataMintLaunchRefs,
} from '@/lib/solana/token-metadata-cm-mint'

/**
 * Ecosystem watch-list for Solana Transaction V1 (SIMD-0385).
 * First-party RPC reads use MAX_SUPPORTED_TRANSACTION_VERSION=1; these vendors still need tracking.
 */
export type SolanaTxV1VendorWatch = {
  id: string
  packageName: string
  risk: 'high' | 'medium' | 'watch'
  detail: string
  mitigation: string
}

export const SOLANA_TX_V1_VENDOR_WATCHLIST: SolanaTxV1VendorWatch[] = [
  {
    id: 'umi-rpc-web3js',
    packageName: '@metaplex-foundation/umi-rpc-web3js',
    risk: 'high',
    detail:
      'createWeb3JsRpc hard-codes maxSupportedTransactionVersion to zero on getTransaction. TransactionVersion type is legacy|0 only.',
    mitigation:
      'Owltopia mint confirms poll getSignatureStatuses / first-party web3.js verifies. Prefer web3.js for tx-body reads; patch or upgrade Umi when Metaplex ships v1.',
  },
  {
    id: 'irys-upload-solana',
    packageName: '@irys/upload-solana',
    risk: 'medium',
    detail:
      'Fund confirmation getTransaction/getParsedTransaction hard-code maxSupportedTransactionVersion to zero.',
    mitigation:
      'Owl Center Irys uploads can fail fund confirmation if the funding tx is v1. Watch package upgrades; patch if funding breaks after mainnet activation.',
  },
  {
    id: 'switchboard-on-demand',
    packageName: '@switchboard-xyz/on-demand',
    risk: 'watch',
    detail: 'VRF path uses asV0Tx + confirmTransaction / account loads — no getTransaction version ceiling today.',
    mitigation: 'Re-check on Switchboard upgrades; keep building v0 until their SDK supports v1 send.',
  },
  {
    id: 'helius-das',
    packageName: 'helius-rpc (DAS fetch helpers)',
    risk: 'watch',
    detail: 'DAS NFT helpers do not fetch transaction bodies; archival getTransaction stays on primary RPC via app code.',
    mitigation: 'No code change; same-origin /api/solana/rpc clamps getTransaction/getBlock ceilings to >= 1.',
  },
]

export function summarizeSolanaTxV1VendorWatch(): string {
  return SOLANA_TX_V1_VENDOR_WATCHLIST.map((v) => `${v.id}[${v.risk}]`).join(', ')
}

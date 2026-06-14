/** Env-only Irys config — safe for server routes (no @irys/* imports). */
export function isIrysUploadConfigured(): boolean {
  return Boolean(process.env.IRYS_PRIVATE_KEY?.trim())
}

export function irysNetworkLabel(): 'devnet' | 'mainnet' {
  return process.env.IRYS_NETWORK?.trim().toLowerCase() === 'devnet' ? 'devnet' : 'mainnet'
}

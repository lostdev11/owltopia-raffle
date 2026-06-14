/** Extra HTTPS hosts to race when resolving Arweave transaction paths in the image proxy. */
export const ARWEAVE_EXTRA_GATEWAY_HOSTS = ['ar-io.net', 'gateway.irys.xyz', 'uploader.irys.xyz'] as const

export function appendArweaveMirrorHttpsUrls(urls: string[], txPath: string): void {
  const clean = txPath.replace(/^\//, '')
  if (!clean) return
  for (const host of ARWEAVE_EXTRA_GATEWAY_HOSTS) {
    urls.push(`https://${host}/${clean}`)
  }
}

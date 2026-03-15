/**
 * Scam / spam NFT blocklist for filtering wallet NFT lists.
 * Supports env list (SCAM_NFT_BLOCKLIST) and optional URL (SCAM_NFT_BLOCKLIST_URL).
 * Blocked addresses can be mint addresses and/or collection addresses.
 */

let cachedBlocklist: Set<string> | null = null
let cacheTime = 0
const CACHE_MS = 5 * 60 * 1000 // 5 minutes

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 32 && s.length <= 44)
}

/**
 * Load blocklist from SCAM_NFT_BLOCKLIST (comma or newline separated)
 * and optionally from SCAM_NFT_BLOCKLIST_URL (JSON: string[] or { addresses?: string[], mints?: string[], collections?: string[] }).
 * Returns set of lowercase addresses. Result is cached for 5 minutes.
 */
export async function getScamBlocklist(): Promise<Set<string>> {
  const now = Date.now()
  if (cachedBlocklist !== null && now - cacheTime < CACHE_MS) {
    return cachedBlocklist
  }
  const set = new Set<string>()

  const envList = process.env.SCAM_NFT_BLOCKLIST?.trim()
  if (envList) {
    for (const a of parseAddressList(envList)) {
      set.add(a)
    }
  }

  const url = process.env.SCAM_NFT_BLOCKLIST_URL?.trim()
  if (url) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (Array.isArray(data)) {
          for (const item of data) {
            if (typeof item === 'string') set.add(item.trim().toLowerCase())
          }
        } else if (data && typeof data === 'object') {
          const add = (arr: unknown) => {
            if (!Array.isArray(arr)) return
            for (const item of arr) {
              if (typeof item === 'string') set.add(item.trim().toLowerCase())
            }
          }
          add(data.addresses)
          add(data.mints)
          add(data.collections)
        }
      }
    } catch {
      // keep env-only blocklist
    }
  }

  cachedBlocklist = set
  cacheTime = now
  return set
}

/** Check if a mint or collection address is blocklisted. Addresses are compared case-insensitively. */
export function isBlocked(blocklist: Set<string>, mintOrCollection: string): boolean {
  return blocklist.has(mintOrCollection.trim().toLowerCase())
}

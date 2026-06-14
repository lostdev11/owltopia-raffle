'use client'

import { useCallback, useEffect, useState } from 'react'

/** Owltopia SIWS wallet from httpOnly cookie — null when unsigned in. */
export async function fetchSiwsSessionWallet(): Promise<string | null> {
  const res = await fetch('/api/auth/wallet-session', { credentials: 'include', cache: 'no-store' })
  if (!res.ok) return null
  const j = (await res.json().catch(() => ({}))) as { wallet?: unknown }
  return typeof j.wallet === 'string' && j.wallet.trim() ? j.wallet.trim() : null
}

/** undefined = still checking, null = unsigned in, string = signed-in wallet. */
export function useSiwsSession() {
  const [sessionWallet, setSessionWallet] = useState<string | null | undefined>(undefined)

  const checkSession = useCallback(async () => {
    const wallet = await fetchSiwsSessionWallet()
    setSessionWallet(wallet)
    return wallet
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  return {
    sessionWallet,
    signedIn: sessionWallet != null,
    checking: sessionWallet === undefined,
    checkSession,
  }
}

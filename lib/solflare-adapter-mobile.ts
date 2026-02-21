'use client'

/**
 * Solflare adapter that passes redirect_link to the SDK so mobile redirects
 * return to the exact page (required for connection callback to complete).
 * The official @solana/wallet-adapter-solflare only passes `network` to the SDK.
 */

import {
  WalletConfigError,
  WalletConnectionError,
  WalletLoadError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletReadyState,
  isIosAndRedirectable,
} from '@solana/wallet-adapter-base'
import { PublicKey } from '@solana/web3.js'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import type { WalletAdapterNetwork } from '@solana/wallet-adapter-base'

export class SolflareWalletAdapterMobile extends SolflareWalletAdapter {
  override async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return
      if (
        this.readyState !== WalletReadyState.Loadable &&
        this.readyState !== WalletReadyState.Installed
      ) {
        throw new WalletNotReadyError()
      }
      // iOS: open in Solflare in-wallet browser (unchanged)
      if (
        this.readyState === WalletReadyState.Loadable &&
        isIosAndRedirectable()
      ) {
        const url = encodeURIComponent(window.location.href)
        const ref = encodeURIComponent(window.location.origin)
        window.location.href = `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`
        return
      }
      let SolflareClass
      try {
        SolflareClass = (await import('@solflare-wallet/sdk')).default
      } catch (error) {
        throw new WalletLoadError((error as Error)?.message, error as Error)
      }
      const network = (this as unknown as { _config: { network?: WalletAdapterNetwork } })._config?.network
      // Pass full URL as redirect_link so Solflare app redirects back to this page with callback params
      const params: Record<string, string> = {}
      if (typeof window !== 'undefined') {
        params.redirect_link = window.location.href
      }
      let wallet
      try {
        wallet = new SolflareClass({ network, params })
      } catch (error) {
        throw new WalletConfigError((error as Error)?.message, error as Error)
      }
      ;(this as unknown as { _connecting: boolean })._connecting = true
      if (!wallet.connected) {
        await wallet.connect()
      }
      if (!wallet.publicKey) throw new WalletConnectionError()
      const publicKey = new PublicKey(wallet.publicKey.toBytes())
      wallet.on('disconnect', (this as unknown as { _disconnected: () => void })._disconnected)
      wallet.on('accountChanged', (this as unknown as { _accountChanged: (key: unknown) => void })._accountChanged)
      ;(this as unknown as { _wallet: typeof wallet })._wallet = wallet
      ;(this as unknown as { _publicKey: PublicKey | null })._publicKey = publicKey
      this.emit('connect', publicKey)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.emit('error', new WalletConnectionError(err.message, err))
      throw error
    } finally {
      ;(this as unknown as { _connecting: boolean })._connecting = false
    }
  }
}

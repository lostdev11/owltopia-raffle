'use client'

import { useCallback, useEffect, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OWL_TICKER } from '@/lib/council/owl-ticker'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { depositOwlToWalletFromWallet } from '@/lib/solana/deposit-owl-to-marketplace-escrow'
import { depositSolToWalletFromWallet } from '@/lib/solana/deposit-sol-to-wallet'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

type FundAsset = 'sol' | 'owl'

const SOL_PRESETS = [0.1, 0.5, 1, 2] as const
const OWL_PRESETS = [100, 500, 1000, 5000] as const

function parsePositive(raw: string): number | null {
  const n = Number(raw.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

export function AdminPacksVaultFundingForm({
  vaultAddress,
  vaultSolBalance,
  vaultOwlBalance,
  onDeposited,
}: {
  vaultAddress: string | null
  vaultSolBalance: number | null
  vaultOwlBalance: number | null
  onDeposited: () => Promise<void>
}) {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const sendTransaction = useSendTransactionForWallet()

  const [asset, setAsset] = useState<FundAsset>('sol')
  const [amount, setAmount] = useState('0.5')
  const [walletSol, setWalletSol] = useState<number | null>(null)
  const [walletOwl, setWalletOwl] = useState<number | null>(null)
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadBalances = useCallback(async () => {
    if (!publicKey) return
    setLoadingBalances(true)
    setBalanceError(null)
    try {
      const lamports = await connection.getBalance(publicKey, 'confirmed')
      setWalletSol(lamports / LAMPORTS_PER_SOL)

      if (!isOwlEnabled()) {
        setWalletOwl(null)
        return
      }
      const owl = getTokenInfo('OWL')
      const mintStr = owl.mintAddress?.trim()
      if (!mintStr) {
        setWalletOwl(null)
        return
      }
      const mintPk = new PublicKey(mintStr)
      const res = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: mintPk }, 'confirmed')
      let totalRaw = 0n
      for (const { account } of res.value) {
        const info = account.data?.parsed?.info as { tokenAmount?: { amount?: string } } | undefined
        const amtStr = info?.tokenAmount?.amount
        if (typeof amtStr === 'string' && /^[0-9]+$/.test(amtStr)) {
          totalRaw += BigInt(amtStr)
        }
      }
      setWalletOwl(Number(totalRaw) / 10 ** owl.decimals)
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : 'Failed to load wallet balances')
    } finally {
      setLoadingBalances(false)
    }
  }, [connection, publicKey])

  useEffect(() => {
    if (publicKey) void loadBalances()
  }, [publicKey, loadBalances])

  function selectAsset(next: FundAsset) {
    setAsset(next)
    setError(null)
    setSuccess(null)
    if (next === 'sol') {
      setAmount('0.5')
    } else {
      setAmount('1000')
    }
  }

  async function deposit() {
    if (!publicKey || !vaultAddress) {
      setError('Connect a wallet and configure the packs vault first.')
      return
    }

    const value = parsePositive(amount)
    if (value == null) {
      setError(asset === 'sol' ? 'Enter a valid SOL amount.' : `Enter a valid ${OWL_TICKER} amount.`)
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      if (asset === 'sol') {
        const dep = await depositSolToWalletFromWallet({
          connection,
          publicKey,
          sendTransaction,
          recipientAddress: vaultAddress,
          amountSol: value,
        })
        if (!dep.ok) {
          setError(dep.error)
          return
        }
        setSuccess(`Deposited ${value} SOL to the packs vault.`)
      } else {
        if (!isOwlEnabled()) {
          setError(`${OWL_TICKER} is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS).`)
          return
        }
        const dep = await depositOwlToWalletFromWallet({
          connection,
          publicKey,
          sendTransaction,
          escrowAddress: vaultAddress,
          amountUi: value,
        })
        if (!dep.ok) {
          setError(dep.error)
          return
        }
        setSuccess(`Deposited ${value.toLocaleString()} ${OWL_TICKER} to the packs vault.`)
      }

      await onDeposited()
      await loadBalances()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deposit failed')
    } finally {
      setBusy(false)
    }
  }

  const owlEnabled = isOwlEnabled()
  const amountNum = parsePositive(amount)
  const canDeposit =
    Boolean(publicKey && vaultAddress) &&
    !busy &&
    amountNum != null &&
    (asset !== 'owl' || owlEnabled)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Fund vault (SOL / {OWL_TICKER})</h2>
        <p className="text-xs text-muted-foreground">
          Send SOL or {OWL_TICKER} from your connected wallet to the packs vault for prize payouts and
          tx fees. NFT prizes use the section below.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p>
          Vault SOL: {vaultSolBalance != null ? vaultSolBalance.toFixed(4) : '—'} · Vault {OWL_TICKER}:{' '}
          {vaultOwlBalance != null
            ? vaultOwlBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : owlEnabled
              ? '—'
              : 'not configured'}
        </p>
        {publicKey && (
          <p className="mt-1 text-xs text-muted-foreground">
            Your wallet: {walletSol != null ? `${walletSol.toFixed(4)} SOL` : '—'}
            {owlEnabled && walletOwl != null
              ? ` · ${walletOwl.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${OWL_TICKER}`
              : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={asset === 'sol' ? 'default' : 'outline'}
          className="min-h-[44px] touch-manipulation"
          onClick={() => selectAsset('sol')}
        >
          SOL
        </Button>
        <Button
          type="button"
          size="sm"
          variant={asset === 'owl' ? 'default' : 'outline'}
          className="min-h-[44px] touch-manipulation"
          disabled={!owlEnabled}
          onClick={() => selectAsset('owl')}
        >
          {OWL_TICKER}
        </Button>
        {!owlEnabled && (
          <span className="text-xs text-muted-foreground self-center">
            {OWL_TICKER} mint not configured
          </span>
        )}
      </div>

      <div>
        <Label htmlFor="packs-fund-amount">
          Amount ({asset === 'sol' ? 'SOL' : OWL_TICKER})
        </Label>
        <Input
          id="packs-fund-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 min-h-[44px] touch-manipulation"
          placeholder={asset === 'sol' ? '0.5' : '1000'}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {asset === 'sol'
            ? SOL_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] touch-manipulation"
                  onClick={() => setAmount(String(preset))}
                >
                  {preset} SOL
                </Button>
              ))
            : OWL_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] touch-manipulation"
                  onClick={() => setAmount(String(preset))}
                >
                  {preset.toLocaleString()}
                </Button>
              ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-[44px] touch-manipulation"
          disabled={!canDeposit}
          onClick={() => void deposit()}
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Depositing…
            </>
          ) : (
            `Deposit ${asset === 'sol' ? 'SOL' : OWL_TICKER} to vault`
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] touch-manipulation"
          disabled={loadingBalances || !publicKey}
          onClick={() => void loadBalances()}
        >
          {loadingBalances ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Refresh balances'
          )}
        </Button>
      </div>

      {balanceError && <p className="text-sm text-destructive">{balanceError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-700 dark:text-green-300">{success}</p>}
    </div>
  )
}

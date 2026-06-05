'use client'

import { Gen2LinkedWalletsPanel } from '@/components/gen2-presale/Gen2LinkedWalletsPanel'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { Button } from '@/components/ui/button'

export function OwlCenterLinkedWalletsSection({
  connected,
  sessionWallet,
  onClusterChange,
}: {
  connected: boolean
  sessionWallet: string | null
  onClusterChange?: () => void
}) {
  const { signIn, signingIn } = useSiwsSignIn()

  return (
    <CommandCard label="linked_wallets.sys">
      <p className="mb-4 text-sm text-[#9BA8B4]">
        Paid from multiple wallets during presale? Link them to one primary account so the checker shows all paid
        presale credits. You still mint from each wallet individually — switch wallets in Phantom or Solflare when minting.
      </p>
      {connected && sessionWallet ? (
        <Gen2LinkedWalletsPanel
          connected={connected}
          sessionWalletHint={sessionWallet}
          onClusterChange={onClusterChange}
        />
      ) : (
        <div className="rounded-xl border border-[#1A222B] bg-[#0F1419] p-4">
          <p className="text-sm text-[#9BA8B4]">Connect your primary presale wallet, then sign in to add linked wallets.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-[44px] touch-manipulation border-[#00FF9C]/35 text-[#EAFBF4]"
            disabled={!connected || signingIn}
            onClick={() => void signIn()}
          >
            {signingIn ? 'Signing in…' : 'Sign in with Owltopia'}
          </Button>
        </div>
      )}
    </CommandCard>
  )
}

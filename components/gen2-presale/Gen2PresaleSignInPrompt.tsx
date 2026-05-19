'use client'

import { Loader2, LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { cn } from '@/lib/utils'

type Props = {
  message: string
  title?: string
  onSignedIn?: () => void
  className?: string
}

/** One-time wallet message sign-in so presale balance APIs can load credits for the connected wallet. */
export function Gen2PresaleSignInPrompt({
  message,
  title = 'Sign in with this wallet',
  onSignedIn,
  className,
}: Props) {
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()

  return (
    <div
      className={cn(
        'rounded-xl border border-amber-400/35 bg-amber-950/35 p-4 text-sm text-amber-50',
        className
      )}
      role="alert"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-amber-50/90">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3 min-h-[44px] touch-manipulation border-amber-300/45 bg-[#10161C] text-amber-50 hover:bg-[#151D24]"
        onClick={() => void signIn({ onSuccess: onSignedIn })}
        disabled={signingIn}
      >
        {signingIn ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <LogIn className="mr-2 h-4 w-4" aria-hidden />
        )}
        Sign in with wallet
      </Button>
      {signInError ? <p className="mt-2 text-sm text-red-300">{signInError}</p> : null}
    </div>
  )
}

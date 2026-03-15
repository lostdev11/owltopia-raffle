'use client'

/**
 * Class-based error boundary used inside the wallet provider tree.
 * Catches render errors from the wallet adapter (e.g. on mobile when wallet is connecting)
 * or from pages like /dashboard, so we show a friendly "Try again" / "Go home" UI
 * instead of the global "Something went wrong" screen.
 */
import { Component, type ReactNode } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ContentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ContentErrorBoundary]', error?.message ?? error, errorInfo?.componentStack)
  }

  reset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="container mx-auto px-4 py-8 max-w-2xl min-h-[50vh] flex flex-col justify-center">
          <div className="flex flex-col items-center text-center gap-4">
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">
              This can happen on mobile when the wallet is still connecting or the page is still loading. Try again or go home.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Button
                onClick={this.reset}
                className="min-h-[44px] min-w-[44px] touch-manipulation"
                type="button"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
              <Button asChild variant="outline" className="min-h-[44px] touch-manipulation">
                <Link href="/">Go home</Link>
              </Button>
            </div>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}

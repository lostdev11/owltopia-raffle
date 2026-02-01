'use client'

import dynamic from 'next/dynamic'

/**
 * Minimal global error boundary. Body content is loaded with ssr: false so
 * prerender does not run code that uses useContext (avoids build failure).
 * Must provide its own <html> and <body>.
 */
const GlobalErrorBody = dynamic(
  () => import('./global-error-body').then((m) => m.default),
  { ssr: false }
)

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
        <GlobalErrorBody reset={reset} />
      </body>
    </html>
  )
}

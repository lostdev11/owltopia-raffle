'use client'

/**
 * Minimal global error boundary. Must provide its own <html> and <body>.
 * Prerender of /_global-error is skipped via scripts/postinstall-next-global-error.js
 * to avoid "Cannot read properties of null (reading 'useContext')" during build.
 */
const bodyStyle = { margin: 0, fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' as const }
const titleStyle = { fontSize: '1.5rem', marginBottom: '1rem' }
const textStyle = { color: '#64748b', marginBottom: '1.5rem' }
const linkStyle = {
  display: 'inline-block',
  padding: '0.5rem 1rem',
  fontSize: '1rem',
  cursor: 'pointer',
  backgroundColor: '#0f172a',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  textDecoration: 'none' as const,
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isServer = typeof window === 'undefined'
  return (
    <html lang="en">
      <body style={bodyStyle}>
        <h1 style={titleStyle}>Something went wrong</h1>
        <p style={textStyle}>An unexpected error occurred. Please try again.</p>
        {isServer ? (
          <a href="/" style={linkStyle}>Try again</a>
        ) : (
          <button
            type="button"
            onClick={reset}
            style={{ ...linkStyle, border: 'none', font: 'inherit' }}
          >
            Try again
          </button>
        )}
      </body>
    </html>
  )
}

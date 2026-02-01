'use client'

/**
 * Minimal global error boundary. Must not import app layout or any component
 * that uses context (e.g. wallet adapter), or prerender may fail with
 * "Cannot read properties of null (reading 'useContext')".
 * This file must provide its own <html> and <body>.
 */
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
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong</h1>
        <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: '#0f172a',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}

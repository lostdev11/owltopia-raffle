'use client'

import type React from 'react'

/**
 * Minimal global error boundary. Must provide its own <html> and <body>.
 * Prerender of /_global-error is skipped via scripts/postinstall-next-global-error.js
 * to avoid "Cannot read properties of null (reading 'useContext')" during build.
 */
const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem',
  textAlign: 'center',
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
}
const titleStyle: React.CSSProperties = { fontSize: '1.5rem', marginBottom: '1rem' }
const textStyle: React.CSSProperties = { color: '#64748b', marginBottom: '1.5rem', maxWidth: '20rem' }
// 44px min height for touch targets (mobile-first)
const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.75rem 1.25rem',
  minHeight: '44px',
  fontSize: '1rem',
  cursor: 'pointer',
  backgroundColor: '#0f172a',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  textDecoration: 'none',
  boxSizing: 'border-box',
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
        <p style={textStyle}>
          An unexpected error occurred. On mobile this can happen when the wallet or page is still loading. Please try again or go home.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
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
          <a href="/" style={{ ...linkStyle, backgroundColor: 'transparent', color: '#64748b', border: '1px solid #334155' }}>
            Go home
          </a>
        </div>
      </body>
    </html>
  )
}

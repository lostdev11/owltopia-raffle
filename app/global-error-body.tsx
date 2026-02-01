'use client'

/** Inner content for global-error; loaded with ssr: false to avoid useContext during prerender. */
export default function GlobalErrorBody({
  reset,
}: {
  reset: () => void
}) {
  return (
    <>
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
    </>
  )
}

/**
 * Smoke: Dashboard SIWS gate renders Ledger path for refund sign-in.
 * Run: npx tsx scripts/test-dashboard-siws-gate.tsx
 */
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { DashboardSiwsSignInGate } from '../components/dashboard/DashboardSiwsSignInGate'

function main() {
  const html = renderToStaticMarkup(
    createElement(DashboardSiwsSignInGate, {
      signingIn: false,
      signInError: 'Invalid signature',
      canSignMessage: true,
      canSignTransaction: true,
      onSignIn: () => {},
      onSignInWithLedgerTx: () => {},
    })
  )

  assert.match(html, /My Dashboard/)
  assert.match(html, /Invalid signature/)
  assert.match(html, /Sign with Ledger transaction/)
  assert.match(html, /Sign in with wallet/)
  assert.match(html, /ticket refunds/)

  const noLedger = renderToStaticMarkup(
    createElement(DashboardSiwsSignInGate, {
      signingIn: false,
      signInError: null,
      canSignMessage: true,
      canSignTransaction: false,
      onSignIn: () => {},
      onSignInWithLedgerTx: () => {},
    })
  )
  assert.doesNotMatch(noLedger, /Sign with Ledger transaction/)

  // Write browser-viewable proof of the shipped gate markup (for walkthrough screenshot).
  const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard SIWS gate (Ledger refund fix)</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --background: 222 20% 8%;
      --foreground: 40 20% 96%;
      --muted-foreground: 215 12% 65%;
      --destructive: 0 72% 55%;
      --border: 215 14% 22%;
    }
    body { background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: ui-sans-serif, system-ui, sans-serif; }
    .text-muted-foreground { color: hsl(var(--muted-foreground)); }
    .text-destructive { color: hsl(var(--destructive)); }
    .text-foreground { color: hsl(var(--foreground)); }
    .border-border\\/60 { border-color: hsl(var(--border) / 0.6); }
    .bg-muted\\/30 { background: hsl(215 14% 18% / 0.3); }
    .bg-green-600 { background: #16a34a; }
    .hover\\:bg-green-700:hover { background: #15803d; }
    .text-white { color: #fff; }
    button { border-radius: 0.5rem; padding: 0.6rem 1rem; border: 1px solid hsl(var(--border)); }
    button.bg-green-600 { border-color: transparent; }
  </style>
</head>
<body class="p-6">${html}</body>
</html>`

  const outPath = '/opt/cursor/artifacts/dashboard-siws-gate-preview.html'
  require('node:fs').writeFileSync(outPath, doc, 'utf8')
  console.log(JSON.stringify({ ok: true, outPath, hasLedgerCta: true, showsInvalidSignature: true }, null, 2))
}

main()

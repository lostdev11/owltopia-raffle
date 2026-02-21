const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve icon.png when browser requests favicon.ico (avoids 404 in console)
  async rewrites() {
    return [
      { source: '/favicon.ico', destination: '/icon.png' },
    ]
  },
  // Silence Turbopack/webpack config mismatch when using custom webpack config
  turbopack: {
    // Use this directory as workspace root so Next doesn't warn about parent lockfile
    root: __dirname,
  },
  // Use project root for file tracing (webpack) so Next doesn't use parent lockfile
  outputFileTracingRoot: path.join(__dirname),
  // Disable dev indicators to avoid Next.js devtools (segment explorer) running during SSR,
  // which can trigger "Cannot read properties of null (reading 'useContext')" with webpack
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  async headers() {
    return [
      {
        // Cache default OG image (Vercel OG API route) so crawlers get fast, cacheable responses
        source: '/api/og',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600' },
        ],
      },
      {
        // Cache per-raffle OG images (generated for each slug)
        source: '/raffles/:slug/opengraph-image',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=3600' },
        ],
      },
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), fullscreen=(self)'
          },
          {
            // Content-Security-Policy that allows wallet extensions and necessary resources
            // 'unsafe-inline' and 'unsafe-eval' are needed for Next.js and wallet adapters
            // Wallet extensions (Phantom, etc.) inject scripts via chrome-extension:// URLs which are allowed by default
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://solana.drpc.org https://va.vercel-scripts.com",
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://fonts.gstatic.com",
              // Allow RPC connections - includes common providers and HTTPS connections for custom endpoints
              // This allows any HTTPS RPC endpoint to work (required for custom RPC providers)
              "connect-src 'self' https: wss: https://*.supabase.co https://*.helius-rpc.com https://*.quiknode.pro https://*.alchemy.com https://*.alchemyapi.io https://*.rpcpool.com https://solana.drpc.org wss://solana.drpc.org https://*.drpc.org wss://*.drpc.org https://api.mainnet-beta.solana.com https://*.mainnet-beta.solana.com",
              "frame-src 'self'",
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests"
            ].join('; ')
          }
        ],
      },
    ]
  },
  webpack: (config, { isServer }) => {
    // Force a single React instance so wallet adapter's useContext works (avoids "Invalid hook call" / useContext null)
    // Use package directory (not index.js) so subpaths like react/jsx-runtime resolve correctly
    config.resolve.alias = {
      ...config.resolve.alias,
      react: path.dirname(require.resolve('react/package.json')),
      'react-dom': path.dirname(require.resolve('react-dom/package.json')),
    }

    // Suppress warnings about optional dependencies
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'pino-pretty': false,
      }
    }
    
    // Externalize Solana packages for server-side builds to avoid bundling issues
    // This prevents Next.js from trying to bundle these packages incorrectly
    if (isServer) {
      config.externals = config.externals || []
      if (Array.isArray(config.externals)) {
        config.externals.push('@solana/web3.js', '@solana/spl-token')
      } else if (typeof config.externals === 'object') {
        config.externals['@solana/web3.js'] = '@solana/web3.js'
        config.externals['@solana/spl-token'] = '@solana/spl-token'
      }
    }
    
    return config
  },
}

module.exports = nextConfig

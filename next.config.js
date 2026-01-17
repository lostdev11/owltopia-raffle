/** @type {import('next').NextConfig} */
const nextConfig = {
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
  webpack: (config, { isServer }) => {
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

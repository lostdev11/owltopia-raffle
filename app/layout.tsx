import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { WalletContextProvider } from '@/components/WalletProvider'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { ErrorHandler } from '@/components/ErrorHandler'

const plusJakartaSans = Plus_Jakarta_Sans({ 
  subsets: ['latin'],
  variable: '--font-plus-jakarta-sans',
  weight: ['300', '400', '500', '600', '700', '800'],
})

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#0f172a',
  interactiveWidget: 'resizes-content' as const,
}

export const metadata: Metadata = {
  title: 'Owl Raffle',
  description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
  icons: {
    icon: [
      { url: '/icon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon.png', sizes: '96x96', type: 'image/png' },
    ],
    shortcut: '/icon.png',
    apple: [
      { url: '/icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/icon.png', sizes: '152x152', type: 'image/png' },
      { url: '/icon.png', sizes: '144x144', type: 'image/png' },
      { url: '/icon.png', sizes: '120x120', type: 'image/png' },
      { url: '/icon.png', sizes: '114x114', type: 'image/png' },
      { url: '/icon.png', sizes: '76x76', type: 'image/png' },
      { url: '/icon.png', sizes: '72x72', type: 'image/png' },
      { url: '/icon.png', sizes: '60x60', type: 'image/png' },
      { url: '/icon.png', sizes: '57x57', type: 'image/png' },
    ],
  },
  openGraph: {
    type: 'website',
    siteName: 'Owl Raffle',
    title: 'Owl Raffle',
    description: 'Trusted raffles with full transparency. Every entry verified on-chain.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: 'Owl Raffle',
    statusBarStyle: 'default',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${plusJakartaSans.variable} font-sans min-h-full flex flex-col`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Catch errors immediately, before React hydrates
                const originalError = console.error;
                
                console.error = function(...args) {
                  const errorString = args.map(arg => {
                    if (typeof arg === 'object' && arg !== null) {
                      return JSON.stringify(arg) + (arg.stack || '');
                    }
                    return String(arg);
                  }).join(' ').toLowerCase();
                  
                  const errorObj = args.find(arg => arg && typeof arg === 'object' && (arg instanceof Error || arg.stack));
                  const errorStack = (errorObj?.stack || '').toLowerCase();
                  
                  const hasSolanaScript = errorString.includes('solanaactionscontentscript') || 
                                          errorStack.includes('solanaactionscontentscript');
                  const hasSomethingWentWrong = errorString.includes('something went wrong');
                  const hasExtension = errorString.includes('extension://') || 
                                      errorString.includes('extension') ||
                                      errorStack.includes('extension');
                  const isConnectionError = 
                    errorString.includes('connection') && errorString.includes('error') ||
                    errorStack.includes('walletconnectionerror') ||
                    errorStack.includes('connectionerror');
                  const isUnexpectedError = 
                    errorString.includes('unexpected error') ||
                    errorStack.includes('unexpected error');
                  
                  if (hasSolanaScript || 
                      (hasSomethingWentWrong && (hasSolanaScript || hasExtension || errorString.includes('solana') || errorString.includes('wallet'))) ||
                      errorStack.includes('solanaactionscontentscript.js') ||
                      errorString.includes('runtime.lasterror') ||
                      errorString.includes('receiving end does not exist') ||
                      errorString.includes('could not establish connection') ||
                      // Phantom-specific errors
                      errorString.includes('[phantom]') ||
                      (errorString.includes('phantom') && (errorString.includes('error updating cache') || errorString.includes('connection'))) ||
                      // StandardWallet adapter connection errors
                      (isConnectionError && isUnexpectedError) ||
                      (isConnectionError && errorStack.includes('standardwalletadapter'))) {
                    return; // Suppress
                  }
                  
                  originalError.apply(console, args);
                };
                
                // Handle unhandled promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                  const reason = (event.reason?.toString() || '').toLowerCase();
                  const errorStack = (event.reason?.stack || '').toLowerCase();
                  const errorMessage = (event.reason?.message || '').toLowerCase();
                  
                  const hasSolanaScript = reason.includes('solanaactionscontentscript') || 
                                          errorStack.includes('solanaactionscontentscript');
                  const hasSomethingWentWrong = reason.includes('something went wrong') || 
                                                errorMessage.includes('something went wrong');
                  const isConnectionError = 
                    reason.includes('connection') && reason.includes('error') ||
                    errorStack.includes('walletconnectionerror') ||
                    errorStack.includes('connectionerror');
                  const isUnexpectedError = 
                    reason.includes('unexpected error') ||
                    errorMessage.includes('unexpected error') ||
                    errorStack.includes('unexpected error');
                  
                  if (hasSolanaScript || 
                      (hasSomethingWentWrong && (hasSolanaScript || reason.includes('extension') || reason.includes('solana') || reason.includes('wallet'))) ||
                      errorStack.includes('solanaactionscontentscript.js') ||
                      reason.includes('receiving end does not exist') ||
                      reason.includes('could not establish connection') ||
                      // Phantom-specific errors
                      reason.includes('[phantom]') ||
                      (reason.includes('phantom') && (reason.includes('error updating cache') || reason.includes('connection'))) ||
                      // StandardWallet adapter connection errors
                      (isConnectionError && isUnexpectedError) ||
                      (isConnectionError && errorStack.includes('standardwalletadapter'))) {
                    event.preventDefault();
                  }
                });
                
                // Handle global errors
                window.addEventListener('error', function(event) {
                  const errorMessage = (event.message || '').toLowerCase();
                  const errorSource = (event.filename || '').toLowerCase();
                  const errorStack = (event.error?.stack || '').toLowerCase();
                  
                  const hasSolanaScript = errorSource.includes('solanaactionscontentscript') || 
                                          errorStack.includes('solanaactionscontentscript');
                  const hasSomethingWentWrong = errorMessage.includes('something went wrong');
                  const isConnectionError = 
                    errorMessage.includes('connection') && errorMessage.includes('error') ||
                    errorStack.includes('walletconnectionerror') ||
                    errorStack.includes('connectionerror');
                  const isUnexpectedError = 
                    errorMessage.includes('unexpected error') ||
                    errorStack.includes('unexpected error');
                  
                  if (hasSolanaScript || 
                      (hasSomethingWentWrong && (hasSolanaScript || errorSource.includes('extension') || errorStack.includes('solana'))) ||
                      errorMessage.includes('receiving end does not exist') ||
                      errorMessage.includes('could not establish connection') ||
                      // Phantom-specific errors
                      errorMessage.includes('[phantom]') ||
                      (errorMessage.includes('phantom') && (errorMessage.includes('error updating cache') || errorMessage.includes('connection'))) ||
                      // StandardWallet adapter connection errors
                      (isConnectionError && isUnexpectedError) ||
                      (isConnectionError && errorStack.includes('standardwalletadapter'))) {
                    event.preventDefault();
                  }
                });
              })();
            `,
          }}
        />
        <ErrorHandler />
        <WalletContextProvider>
          <div className="flex flex-col min-h-screen">
            <Header />
            <main className="flex-1">
              {children}
            </main>
            <Footer />
          </div>
        </WalletContextProvider>
      </body>
    </html>
  )
}

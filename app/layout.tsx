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

export const metadata: Metadata = {
  title: 'Owl Raffle',
  description: 'Transparent raffles with Owl Vision trust scoring',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
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

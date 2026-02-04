'use client'

import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { SettingsPopover } from '@/components/SettingsPopover'
import { GuidedTour } from '@/components/GuidedTour'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const [showHelp, setShowHelp] = useState(false)
  const pathname = usePathname()

  const isFullBleed = /^\/(trace|tools|bins)\//.test(pathname)

  return (
    <html lang="en">
      <head>
        <title>Tracefinity</title>
        <meta name="description" content="Generate gridfinity bins from photos of tools" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body className="bg-base text-text-primary min-h-screen">
        <QueryClientProvider client={queryClient}>
          <header className="bg-surface border-b border-border">
            <div className="px-4 py-2.5 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2.5 text-base font-bold tracking-tight hover:opacity-80" style={{ color: '#f1f5f9' }}>
                <img src="/favicon.svg" alt="" className="w-7 h-7 rounded-[4px]" />
                Tracefinity
              </Link>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowHelp(true)}
                  className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
                  title="How it works"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
                <SettingsPopover />
                <div id="account-slot" />
              </div>
            </div>
          </header>
          <main className={isFullBleed ? '' : 'px-4 py-4'}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
          <GuidedTour open={showHelp} onClose={() => setShowHelp(false)} />
        </QueryClientProvider>
      </body>
    </html>
  )
}

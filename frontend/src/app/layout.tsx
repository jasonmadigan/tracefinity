'use client'

import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { SettingsPopover } from '@/components/SettingsPopover'
import { ThemeToggle } from '@/components/ThemeToggle'
import { GuidedTour } from '@/components/GuidedTour'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { IconButton } from '@/components/IconButton'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const [showHelp, setShowHelp] = useState(false)
  const pathname = usePathname()

  const isFullBleed = pathname === '/trace' || /^\/(trace|tools|bins|stations)\//.test(pathname)

  return (
    <html lang="en">
      <head>
        <title>Tracefinity</title>
        <meta name="description" content="Generate gridfinity bins from photos of tools" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body className="bg-base text-text-primary min-h-screen">
        <QueryClientProvider client={queryClient}>
          <header className="h-11 bg-surface/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
            <div className="h-full px-4 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight text-text-primary hover:opacity-80 flex-shrink-0">
                <img src="/favicon.svg" alt="" className="w-6 h-6 rounded-[3px]" />
                Tracefinity
              </Link>
              <div className="flex items-center gap-0.5">
                <ThemeToggle />
                <IconButton onClick={() => setShowHelp(true)} title="How it works">
                  <HelpCircle className="w-4 h-4" />
                </IconButton>
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

import { Inter } from 'next/font/google'
import './globals.css'
import ErrorBoundary from './ErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'NeuralOS',
  description: 'Your company, running on intelligence',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  )
}
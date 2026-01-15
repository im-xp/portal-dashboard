import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { AuthProvider } from '@/components/providers/AuthProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'The Portal Dashboard',
  description: 'Admin dashboard for popup city operations',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <MobileNav />
            <main className="flex-1 min-w-0 md:ml-64 bg-zinc-50 pt-14 pb-16 md:pt-0 md:pb-0">
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}

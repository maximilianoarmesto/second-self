import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SidebarLayout } from '@/components/layout/SidebarLayout';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Second Self',
  description: 'Your AI-powered digital clone',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SidebarLayout>{children}</SidebarLayout>
      </body>
    </html>
  );
}

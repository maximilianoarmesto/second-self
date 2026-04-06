import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Second Self',
  description: 'AI-powered personal assistant application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <nav className="border-b bg-card">
            <div className="container mx-auto flex h-14 items-center gap-6 px-4">
              <Link href="/" className="font-semibold text-foreground hover:text-primary transition-colors">
                Second Self
              </Link>
              <div className="flex items-center gap-4 text-sm">
                <Link
                  href="/"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Chat
                </Link>
                <Link
                  href="/knowledge-base"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Knowledge Base
                </Link>
              </div>
            </div>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}

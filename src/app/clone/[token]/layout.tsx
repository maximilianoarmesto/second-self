import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
    ],
    shortcut: '/favicon.ico',
  },
};

export default function CloneLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

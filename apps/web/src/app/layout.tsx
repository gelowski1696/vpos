import './globals.css';
import 'sileo/styles.css';
import type { Metadata } from 'next';
import { Manrope, Sora } from 'next/font/google';
import { WebToaster } from '../components/web-toaster';

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap'
});

const headingFont = Sora({
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap'
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://vmjamtech.com'),
  title: {
    default: 'VMJAMTECH VPOS | LPG POS and Inventory Platform',
    template: '%s | VMJAMTECH VPOS'
  },
  description: 'VMJAMTECH VPOS is a Philippine-ready LPG POS and inventory operations platform for branches and outlets.',
  applicationName: 'VMJAMTECH VPOS',
  keywords: ['vmjamtech', 'vpos', 'lpg pos philippines', 'lpg inventory system', 'branch outlet pos'],
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png'
  },
  openGraph: {
    type: 'website',
    siteName: 'VMJAMTECH VPOS',
    title: 'VMJAMTECH VPOS | LPG POS and Inventory Platform',
    description: 'Philippine-ready LPG POS, inventory, transfer, and reporting platform by VMJAMTECH.',
    url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://vmjamtech.com',
    images: [
      {
        url: '/logo.png',
        width: 512,
        height: 512,
        alt: 'VMJAMTECH VPOS logo'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VMJAMTECH VPOS',
    description: 'Philippine-ready LPG POS and inventory platform by VMJAMTECH.',
    images: ['/logo.png']
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html className={`${bodyFont.variable} ${headingFont.variable}`} lang="en">
      <body>
        {children}
        <WebToaster />
      </body>
    </html>
  );
}

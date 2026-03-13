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
    default: 'VPOS Web Admin',
    template: '%s | VPOS Web'
  },
  description: 'VPOS LPG POS and Inventory Web Admin',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png'
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

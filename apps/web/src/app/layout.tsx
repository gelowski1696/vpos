import './globals.css';
import 'sileo/styles.css';
import type { Metadata } from 'next';
import { WebToaster } from '../components/web-toaster';

export const metadata: Metadata = {
  title: 'VPOS Admin',
  description: 'VPOS LPG POS and Inventory Web Admin'
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        {children}
        <WebToaster />
      </body>
    </html>
  );
}

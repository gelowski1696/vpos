import type { Metadata } from 'next';
import { HomeLandingShowcase } from '../components/home-landing-showcase';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://vmjamtech.com';

export const metadata: Metadata = {
  title: 'VPOS Web Admin | LPG Operations Platform',
  description:
    'Modern LPG operations admin: sales, inventory, transfers, reporting, tenant controls, and branch-level execution.',
  keywords: ['LPG POS', 'LPG inventory', 'multi-tenant POS', 'branch management', 'sales and transfers'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: siteUrl,
    title: 'VPOS Web Admin',
    description:
      'Run LPG operations with smart reporting, stock controls, pricing rules, and owner-grade tenant governance.',
    siteName: 'VPOS Web'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VPOS Web Admin',
    description: 'Operate LPG sales, inventory, and transfers from one control hub.'
  }
};

export default function HomePage(): JSX.Element {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'VPOS Web Admin',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD'
    },
    url: siteUrl,
    description:
      'Web platform for LPG sales, inventory, transfer operations, reporting, and multi-tenant governance.'
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeLandingShowcase />
    </>
  );
}


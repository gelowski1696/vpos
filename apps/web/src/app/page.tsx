import type { Metadata } from 'next';
import { HomeLandingShowcase } from '../components/home-landing-showcase';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://vmjamtech.com';

export const metadata: Metadata = {
  title: 'VMJAMTECH VPOS | LPG Operations Platform Philippines',
  description:
    'VMJAMTECH VPOS is a modern LPG operations platform in the Philippines for sales, inventory, transfers, reporting, and branch/outlet execution.',
  keywords: ['vmjamtech', 'vpos philippines', 'LPG POS', 'LPG inventory', 'multi-tenant POS', 'branch management', 'sales and transfers'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: siteUrl,
    title: 'VMJAMTECH VPOS',
    description:
      'Run LPG operations with smart reporting, stock controls, pricing rules, and owner-grade tenant governance.',
    siteName: 'VMJAMTECH VPOS'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VPOS Web Admin',
    description: 'Operate LPG sales, inventory, and transfers from one control hub.'
  }
};

export default function HomePage(): JSX.Element {
  const softwareStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'VMJAMTECH VPOS',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'PHP'
    },
    url: siteUrl,
    description:
      'Web platform for LPG sales, inventory, transfer operations, reporting, and multi-tenant governance in the Philippines.'
  };

  const organizationStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'VMJAMTECH',
    url: siteUrl,
    logo: `${siteUrl}/logo.png`
  };

  const websiteStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'VMJAMTECH VPOS',
    url: siteUrl
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationStructuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData) }}
      />
      <HomeLandingShowcase />
    </>
  );
}

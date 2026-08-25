import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { DEFAULT_LOCALE, localeTags } from '../lib/i18n';

const geist = localFont({
  src: './fonts/Geist-VariableFont_wght.ttf',
  variable: '--font-sans',
  display: 'swap',
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const siteDescription = 'Fairly split household expenses and understand where you stand.';
const socialTitle = 'Fairsplit — Shared expenses, made fair.';
const socialImage = {
  url: '/branding/og-fairsplit.png',
  width: 1200,
  height: 630,
  alt: socialTitle,
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: 'Fairsplit',
    template: '%s | Fairsplit',
  },
  description: siteDescription,
  applicationName: 'Fairsplit',
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Fairsplit',
    title: socialTitle,
    description: siteDescription,
    images: [socialImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: socialTitle,
    description: siteDescription,
    images: [socialImage],
  },
  appleWebApp: {
    capable: true,
    title: 'Fairsplit',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
      { url: '/branding/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/branding/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/branding/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f8faf9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={localeTags[DEFAULT_LOCALE]} className={geist.variable}>
      <body className="font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}

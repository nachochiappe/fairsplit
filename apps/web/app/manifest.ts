import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fairsplit',
    short_name: 'Fairsplit',
    description: 'Fairly split household expenses and understand where you stand.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f8faf9',
    theme_color: '#f8faf9',
    icons: [
      {
        src: '/branding/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/branding/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}

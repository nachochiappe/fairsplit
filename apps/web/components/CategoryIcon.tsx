import type { CategoryIconKey } from '@fairsplit/shared';
import type { ReactNode } from 'react';

const ICON_PATHS: Record<CategoryIconKey, ReactNode> = {
  home: (
    <>
      <path d="M2.8 9.2 10 3.5l7.2 5.7" />
      <path d="M4.8 8.3v8.2h10.4V8.3M8 16.5v-4.2h4v4.2" />
    </>
  ),
  cart: (
    <>
      <path d="M2.5 4.5h2l1.4 7.1a1.3 1.3 0 0 0 1.3 1h7.5a1.3 1.3 0 0 0 1.2-.9l1.4-4.9H5" />
      <circle cx="8" cy="16" r="1" />
      <circle cx="14.5" cy="16" r="1" />
    </>
  ),
  car: (
    <>
      <path d="M3.2 11.2h13.6l-1.4-4.5a1.5 1.5 0 0 0-1.4-1H6a1.5 1.5 0 0 0-1.4 1l-1.4 4.5Z" />
      <path d="M3.2 11.2v3.6h2.2M16.8 11.2v3.6h-2.2M6.2 14.8h7.6" />
      <circle cx="5.6" cy="12.8" r=".6" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="12.8" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  wallet: (
    <>
      <path d="M3.2 5.2h11.5a2 2 0 0 1 2 2v8.1H4.5a2 2 0 0 1-2-2V5.9a2.4 2.4 0 0 1 1.8-2.3l9.1-2.1v3.7" />
      <path d="M12.2 9h5.3v3.6h-5.3a1.8 1.8 0 1 1 0-3.6Z" />
      <circle cx="12.6" cy="10.8" r=".55" fill="currentColor" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="m9.2 2 .9 3.3a3.8 3.8 0 0 0 2.6 2.6l3.3.9-3.3.9a3.8 3.8 0 0 0-2.6 2.6L9.2 16l-.9-3.7a3.8 3.8 0 0 0-2.6-2.6l-3.3-.9 3.3-.9a3.8 3.8 0 0 0 2.6-2.6L9.2 2Z" />
      <path d="m15.5 13 .4 1.5a2 2 0 0 0 1.4 1.4l1.5.4-1.5.4a2 2 0 0 0-1.4 1.4l-.4 1.5-.4-1.5a2 2 0 0 0-1.4-1.4l-1.5-.4 1.5-.4a2 2 0 0 0 1.4-1.4l.4-1.5Z" />
    </>
  ),
  dots: (
    <>
      <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  utensils: (
    <>
      <path d="M5.5 2v6M3.5 2v4a2 2 0 0 0 4 0V2M5.5 8v10" />
      <path d="M13.5 18v-6.5M13.5 11.5c-2.5-1-2.4-7.8 1-9.5v9.5h-1Z" />
    </>
  ),
  plane: (
    <>
      <path d="m2.5 12.5 6-2.5 2.8-7.2a1.4 1.4 0 0 1 2.6 1l-1.2 6.4 4.8 2.3-1 1.5-4.8-.9-3.2 4.1-1.1-.6 1.1-4.4-4.7 1.5-1.3-1.2Z" />
    </>
  ),
  gift: (
    <>
      <path d="M3 8h14v9H3zM2 5h16v3H2zM10 5v12" />
      <path d="M10 5H6.8a1.8 1.8 0 1 1 1.5-2.8L10 5Zm0 0h3.2a1.8 1.8 0 1 0-1.5-2.8L10 5Z" />
    </>
  ),
  paw: (
    <>
      <ellipse cx="10" cy="13.2" rx="4.2" ry="3.2" />
      <circle cx="4.8" cy="9" r="1.5" />
      <circle cx="7.2" cy="5.5" r="1.5" />
      <circle cx="12.8" cy="5.5" r="1.5" />
      <circle cx="15.2" cy="9" r="1.5" />
    </>
  ),
  heart: <path d="M10 17S3 13 3 7.7A3.7 3.7 0 0 1 10 6a3.7 3.7 0 0 1 7 1.7C17 13 10 17 10 17Z" />,
  medical: (
    <>
      <path d="M7.5 2.8h5v4.7h4.7v5h-4.7v4.7h-5v-4.7H2.8v-5h4.7V2.8Z" />
    </>
  ),
  graduation: (
    <>
      <path d="m2.5 7 7.5-4 7.5 4-7.5 4-7.5-4Z" />
      <path d="M5.5 9v4.2c2.8 2.1 6.2 2.1 9 0V9M17.5 7v5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="5.5" width="15" height="11" rx="1.8" />
      <path d="M7 5.5V3.8h6v1.7M2.5 10h15M8.2 10v1.5h3.6V10" />
    </>
  ),
  tools: (
    <>
      <path d="m12.6 3.2 4.2 4.2M10.8 5l4.2 4.2M3 17l8.2-8.2 1.8 1.8L4.8 18H3v-1Z" />
      <path d="M13.7 2.1 17.9 6.3l-1.4 1.4-4.2-4.2 1.4-1.4Z" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 7.2a11.5 11.5 0 0 1 15 0M5.2 10.2a7.3 7.3 0 0 1 9.6 0M8 13.2a3.2 3.2 0 0 1 4 0" />
      <circle cx="10" cy="16" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  shirt: <path d="m6.5 3 3.5 1.5L13.5 3 18 6l-2 3-2-1.2V17H6V7.8L4 9 2 6l4.5-3Z" />,
  dumbbell: (
    <>
      <path d="M6 7v6M3.5 8v4M14 7v6M16.5 8v4M6 10h8M2 9.2v1.6M18 9.2v1.6" />
    </>
  ),
  baby: (
    <>
      <path d="M4 10a6 6 0 0 1 12 0H4Zm6-6V2.5A2.5 2.5 0 0 1 12.5 5" />
      <path d="M5 10v2a3 3 0 0 0 3 3h6M8 15l-1 2M14 15l1 2" />
      <circle cx="6.5" cy="17" r="1" />
      <circle cx="15.5" cy="17" r="1" />
    </>
  ),
  gamepad: (
    <>
      <path d="M6 7h8a3 3 0 0 1 2.8 2l1.4 4.1a2.2 2.2 0 0 1-3.5 2.4L12.8 14H7.2l-1.9 1.5a2.2 2.2 0 0 1-3.5-2.4L3.2 9A3 3 0 0 1 6 7Z" />
      <path d="M7 9.5v3M5.5 11h3" />
      <circle cx="13.5" cy="10.3" r=".6" fill="currentColor" stroke="none" />
      <circle cx="15.2" cy="12" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 2.5h10v15l-2-1.5-2 1.5L9 16l-2 1.5-2-1.5V2.5Z" />
      <path d="M7.5 6h5M7.5 9h5M7.5 12h3" />
    </>
  ),
  coffee: (
    <>
      <path d="M3.5 7h10v5a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V7Z" />
      <path d="M13.5 8h1.5a2.5 2.5 0 0 1 0 5h-1.8M6 4.8c-.8-.8.8-1.4 0-2.2M10 4.8c-.8-.8.8-1.4 0-2.2" />
    </>
  ),
};

export function CategoryIcon({
  className = 'h-5 w-5',
  icon,
}: {
  className?: string;
  icon: CategoryIconKey;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 20 20"
    >
      {ICON_PATHS[icon]}
    </svg>
  );
}

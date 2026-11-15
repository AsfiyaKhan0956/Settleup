import React from 'react';
import { getInitials } from '../../utils/currency.ts';

export const BrandMark: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#065F46" />
    <path
      d="M20 23.5C20 19.9101 22.9101 17 26.5 17H44V24H27.5C26.6716 24 26 24.6716 26 25.5C26 26.3284 26.6716 27 27.5 27H37.5C41.0899 27 44 29.9101 44 33.5V40.5C44 44.0899 41.0899 47 37.5 47H20V40H36.5C37.3284 40 38 39.3284 38 38.5C38 37.6716 37.3284 37 36.5 37H26.5C22.9101 37 20 34.0899 20 30.5V23.5Z"
      fill="#ECFDF5"
    />
    <circle cx="44" cy="20.5" r="4.5" fill="#34D399" />
  </svg>
);

const AVATAR_TONES = [
  'bg-[#065F46] text-white',
  'bg-[#0F172A] text-white',
  'bg-[#047857] text-white',
  'bg-[#334155] text-white',
  'bg-[#1E293B] text-white',
];

export const UserAvatar: React.FC<{
  name: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}> = ({ name, avatarUrl, size = 'md' }) => {
  const sizeClass =
    size === 'sm' ? 'w-7 h-7 text-[11px]' : size === 'lg' ? 'w-14 h-14 text-base' : 'w-9 h-9 text-xs';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        referrerPolicy="no-referrer"
        className={`${sizeClass} rounded-full object-cover border border-slate-200 shrink-0`}
      />
    );
  }

  const toneIndex =
    name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % AVATAR_TONES.length;

  return (
    <span
      className={`${sizeClass} ${AVATAR_TONES[toneIndex]} rounded-full inline-flex items-center justify-center font-display font-semibold tracking-tight shrink-0 select-none`}
      aria-label={name}
    >
      {getInitials(name)}
    </span>
  );
};

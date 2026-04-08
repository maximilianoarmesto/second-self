import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  /**
   * The rendered size of the logo mark in pixels (width = height).
   * Defaults to 36 to match the sidebar brand badge dimensions.
   */
  size?: number;
  /** Additional class names applied to the outer <svg> element. */
  className?: string;
}

/**
 * Second Self logo mark.
 *
 * Renders a pixel-art "SS" monogram on a solid black rounded-square background,
 * matching the aesthetic of the favicon (public/favicon.svg).
 *
 * The SVG uses a fixed internal viewBox of 32×32 so the artwork is crisp at
 * any rendered size — pass `size` to scale it up or down.
 *
 * Usage:
 *   <Logo />           — 36 px (sidebar default)
 *   <Logo size={28} /> — 28 px (mobile header)
 */
export function Logo({ size = 36, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-label="Second Self logo"
      role="img"
      className={cn('flex-shrink-0', className)}
    >
      {/* Black rounded-square background */}
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="4"
        ry="4"
        fill="currentColor"
        className="text-primary"
      />

      {/* Left "S" — pixel grid lettering */}
      <rect x="11" y="13" width="3" height="1" fill="white" />
      <rect x="10" y="14" width="1" height="1" fill="white" />
      <rect x="14" y="14" width="1" height="1" fill="white" />
      <rect x="10" y="15" width="1" height="1" fill="white" />
      <rect x="11" y="16" width="3" height="1" fill="white" />
      <rect x="14" y="17" width="1" height="1" fill="white" />
      <rect x="10" y="18" width="1" height="1" fill="white" />
      <rect x="14" y="18" width="1" height="1" fill="white" />
      <rect x="11" y="19" width="3" height="1" fill="white" />

      {/* Right "S" — pixel grid lettering */}
      <rect x="18" y="13" width="3" height="1" fill="white" />
      <rect x="17" y="14" width="1" height="1" fill="white" />
      <rect x="21" y="14" width="1" height="1" fill="white" />
      <rect x="17" y="15" width="1" height="1" fill="white" />
      <rect x="18" y="16" width="3" height="1" fill="white" />
      <rect x="21" y="17" width="1" height="1" fill="white" />
      <rect x="17" y="18" width="1" height="1" fill="white" />
      <rect x="21" y="18" width="1" height="1" fill="white" />
      <rect x="18" y="19" width="3" height="1" fill="white" />
    </svg>
  );
}

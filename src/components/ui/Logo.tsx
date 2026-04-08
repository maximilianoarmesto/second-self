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
 * Second Self logo mark — modern abstract AI symbol.
 *
 * The mark is built from three layered geometric ideas that read together as
 * a clean, intentional icon at any size:
 *
 *  1. A rounded-square background with a deep blue → violet gradient — the
 *     "stage" that gives the mark strong contrast against the gray-50 sidebar.
 *
 *  2. Three nodes arranged in a triangular formation (top-center, bottom-left,
 *     bottom-right) connected by diagonal strokes — a minimal neural-network /
 *     graph motif representing AI and interconnected intelligence.
 *
 *  3. A bold green accent ring on the top node — a single highlight that draws
 *     the eye upward and echoes the "active" / "alive" quality of an AI system.
 *
 * The SVG uses a fixed 32×32 viewBox with crisp pixel-aligned geometry so it
 * renders sharply at every size without sub-pixel blurring.
 *
 * Usage:
 *   <Logo />           — 36 px (sidebar default)
 *   <Logo size={28} /> — 28 px (mobile header)
 *   <Logo size={40} /> — 40 px (expanded sidebar)
 */
export function Logo({ size = 36, className }: LogoProps) {
  // Stable IDs scoped to this component instance.
  // Using a literal prefix keeps SSR and client renders consistent.
  const gradBgId = 'logo-grad-bg';
  const gradNodeId = 'logo-grad-node';
  const filterGlowId = 'logo-glow';

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
      <defs>
        {/* Background: deep indigo → violet */}
        <linearGradient id={gradBgId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e3a8a" />   {/* blue-900   */}
          <stop offset="100%" stopColor="#6d28d9" />  {/* violet-700 */}
        </linearGradient>

        {/* Node fill: electric blue → cyan */}
        <linearGradient id={gradNodeId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#60a5fa" />   {/* blue-400  */}
          <stop offset="100%" stopColor="#818cf8" />  {/* indigo-400 */}
        </linearGradient>

        {/* Subtle drop-shadow / glow for the top node so it pops */}
        <filter id={filterGlowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Rounded-square background ─────────────────────────────────── */}
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="6"
        ry="6"
        fill={`url(#${gradBgId})`}
      />

      {/*
        ── Connection strokes (drawn first, behind nodes) ───────────────
        Three lines linking the three node centres:
          Top node      — (16, 8.5)
          Bottom-left   — (8.5, 22)
          Bottom-right  — (23.5, 22)
      */}
      <g stroke="rgba(255,255,255,0.30)" strokeWidth="1.5" strokeLinecap="round">
        {/* Top → Bottom-left */}
        <line x1="16" y1="8.5" x2="8.5" y2="22" />
        {/* Top → Bottom-right */}
        <line x1="16" y1="8.5" x2="23.5" y2="22" />
        {/* Bottom-left → Bottom-right */}
        <line x1="8.5" y1="22" x2="23.5" y2="22" />
      </g>

      {/*
        ── Nodes ────────────────────────────────────────────────────────
        Each node is a small filled circle with a slightly lighter border.
        The top node also carries the green accent ring.
      */}

      {/* Bottom-left node */}
      <circle
        cx="8.5"
        cy="22"
        r="2.8"
        fill={`url(#${gradNodeId})`}
      />
      <circle
        cx="8.5"
        cy="22"
        r="2.8"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="0.6"
      />

      {/* Bottom-right node */}
      <circle
        cx="23.5"
        cy="22"
        r="2.8"
        fill={`url(#${gradNodeId})`}
      />
      <circle
        cx="23.5"
        cy="22"
        r="2.8"
        fill="none"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="0.6"
      />

      {/*
        Top node — primary focal point.
        Rendered last so it sits on top of the connection strokes.
        Carries the green accent ring to signal the "active" node.
      */}
      <circle
        cx="16"
        cy="8.5"
        r="3.5"
        fill={`url(#${gradNodeId})`}
        filter={`url(#${filterGlowId})`}
      />
      {/* Green accent ring */}
      <circle
        cx="16"
        cy="8.5"
        r="3.5"
        fill="none"
        stroke="#4ade80"   /* green-400 */
        strokeWidth="1.2"
      />
    </svg>
  );
}

export default Logo;

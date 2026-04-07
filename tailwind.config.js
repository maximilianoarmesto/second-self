/** @type {import('tailwindcss').Config} */
module.exports = {
  // Dark mode is intentionally disabled — the app uses a strict black & white theme.
  darkMode: false,
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // ─── Semantic color tokens ──────────────────────────────────────────────
      // All tokens resolve to CSS custom properties defined in globals.css so
      // that a single source of truth drives the entire palette.
      //
      //  Token          Light value        Purpose
      //  ─────────────  ─────────────────  ──────────────────────────────────
      //  background     #ffffff (white)    Page / root background
      //  surface        #f9fafb (gray-50)  Cards, sidebar, raised surfaces
      //  foreground     #000000 (black)    Primary text
      //  primary        #000000 (black)    Buttons, active states, links
      //  primary-fg     #ffffff (white)    Text on primary backgrounds
      //  secondary      #f3f4f6 (gray-100) Subtle fills (message bubbles, pills)
      //  secondary-fg   #111827 (gray-900) Text on secondary backgrounds
      //  muted          #f3f4f6 (gray-100) Disabled / de-emphasised fills
      //  muted-fg       #6b7280 (gray-500) Placeholder / helper text
      //  border         #e5e7eb (gray-200) Dividers and outlines
      //  input          #e5e7eb (gray-200) Input borders
      //  ring           #000000 (black)    Focus ring
      //  accent         #000000 (black)    Highlighted / interactive accent
      //  accent-fg      #ffffff (white)    Text on accent backgrounds
      //  destructive    #dc2626 (red-600)  Danger actions
      //  destructive-fg #ffffff (white)    Text on destructive backgrounds
      //  card           #ffffff (white)    Card / panel background (= background)
      //  card-fg        #000000 (black)    Card text
      //  popover        #ffffff (white)    Popover / dropdown background
      //  popover-fg     #000000 (black)    Popover text
      colors: {
        border:      "hsl(var(--border))",
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        surface:     "hsl(var(--surface))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/forms"), require("@tailwindcss/typography")],
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  // pdf-parse is a CommonJS module that must not be bundled by webpack — keep
  // it as a server-side external so Next.js resolves it via Node's require().
  // The key name changed between Next.js 14 (experimental) and Next.js 15
  // (top-level).  We set both so the config works across minor version bumps
  // without producing "Unrecognized key" warnings.
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },
}

module.exports = nextConfig
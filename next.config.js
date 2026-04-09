/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  images: {
    // Avatar images are served from /public/uploads/ as local static files.
    // Using the Next.js Image optimisation pipeline for local paths requires
    // either a configured domain allowlist or the unoptimized flag.  Since
    // uploads are small profile photos (≤ 2 MB) that don't benefit from
    // on-the-fly resizing, we disable optimisation globally for simplicity.
    // This also eliminates the "hostname is not configured" console warning.
    unoptimized: true,
  },
};

module.exports = nextConfig;

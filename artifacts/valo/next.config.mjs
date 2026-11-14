/** @type {import('next').NextConfig} */
const replitHosts = [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS]
  .filter(Boolean)
  .flatMap((v) => String(v).split(','))
  .map((v) => v.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: [...replitHosts, '*.replit.dev', '*.repl.co', '*.replit.app'],
  // Only public values are mapped. The Clerk secret key is never referenced here.
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || '',
    NEXT_PUBLIC_CLERK_PROXY_URL:
      process.env.VITE_CLERK_PROXY_URL || process.env.CLERK_PROXY_URL || '',
    NEXT_PUBLIC_BASE_PATH: (process.env.BASE_PATH || '/').replace(/\/$/, ''),
  },
  transpilePackages: ['@workspace/api-client-react'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      // This is development, not an approved public launch.
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    ] }];
  },
};

export default nextConfig;

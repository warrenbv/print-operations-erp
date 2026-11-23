// Next.js settings for the web application.
// The two 50 MB body limits match `POST_BODY_MAX_BYTES` in apps/web/src/lib/post-too-large.ts. Change them together.
import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),

  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    middlewareClientMaxBodySize: '50mb',
  },
};

export default nextConfig;

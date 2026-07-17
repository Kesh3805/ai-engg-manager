import type { NextConfig } from 'next';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Single source of truth: load the monorepo-root .env into the server process so
// route handlers and server components see DATABASE_URL, NVIDIA keys, etc.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/integrations'],
  // Keep native/node-only server deps out of the bundle.
  serverExternalPackages: ['postgres', 'pg', 'better-auth', '@elastic/elasticsearch', '@slack/web-api', '@linear/sdk', '@octokit/rest', '@octokit/auth-app'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default config;

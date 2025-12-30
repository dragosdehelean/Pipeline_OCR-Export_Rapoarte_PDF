/**
 * @fileoverview Next.js runtime configuration.
 */
const distDir = process.env.NEXT_DIST_DIR;
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: distDir || ".next"
};

module.exports = nextConfig;

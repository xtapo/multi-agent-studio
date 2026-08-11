/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The orchestration runtime keeps long-lived async work alive after the
    // HTTP response has been sent, so we never bundle it into the edge runtime.
    // pg / pg-boss are CommonJS with dynamic requires; bundling them breaks the
    // queue driver, so they stay external too.
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "pg", "pg-boss"],
  },
};

export default nextConfig;

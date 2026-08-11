/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The orchestration runtime keeps long-lived async work alive after the
    // HTTP response has been sent, so we never bundle it into the edge runtime.
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;

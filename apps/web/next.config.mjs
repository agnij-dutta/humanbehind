/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate dist dir lets `next build` run beside `next dev` without clobbering it (zkdir lesson).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@humanbehind/verifier'],
  experimental: {
    // zkdir lesson: snarkjs/ffjavascript/web-worker spawn worker_threads from
    // dynamically computed paths that webpack cannot bundle. Server code here
    // (the dev TEST-QR route) imports @anon-aadhaar/core, which imports snarkjs
    // at module top level. Bundling it produced a 277s hang in zkdir; loading
    // these via Node's native require avoids that entirely.
    serverComponentsExternalPackages: [
      'snarkjs',
      'ffjavascript',
      'web-worker',
      '@anon-aadhaar/core',
      '@humanbehind/core',
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // snarkjs/ffjavascript reference node builtins behind runtime checks.
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false, os: false, readline: false, constants: false, worker_threads: false };
    }
    return config;
  },
};

export default nextConfig;

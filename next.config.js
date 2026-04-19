/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained output directory so the Docker image only copies
  // what is needed to run the app — no node_modules in the final stage.
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["googleapis", "pdf-lib"],
    instrumentationHook: true,
  },
  images: {
    domains: ["lh3.googleusercontent.com"],
  },
};

module.exports = nextConfig;

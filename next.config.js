/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained output directory so the Docker image only copies
  // what is needed to run the app — no node_modules in the final stage.
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["googleapis", "pdf-lib"],
    instrumentationHook: true,
  },
  // googleapis and its transitive deps (google-auth-library, gaxios, agent-base,
  // https-proxy-agent) require Node.js built-ins (http, https, net) that webpack
  // cannot bundle for edge/browser targets.
  //
  // serverComponentsExternalPackages handles RSC + route-handler bundles, but
  // instrumentation.ts is compiled separately with a different webpack config
  // that doesn't inherit those externals. The function below covers that gap:
  // any request matching a Node-only google package is left as a native
  // require() at runtime rather than being bundled.
  webpack(config, { isServer }) {
    if (isServer) {
      const existing = config.externals;
      const nodeOnlyPkgs = [
        "googleapis",
        "google-auth-library",
        "gaxios",
        "agent-base",
        "https-proxy-agent",
      ];
      config.externals = [
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
        ({ request }, callback) => {
          if (
            request &&
            nodeOnlyPkgs.some(
              (pkg) => request === pkg || request.startsWith(pkg + "/")
            )
          ) {
            return callback(null, "commonjs " + request);
          }
          callback();
        },
      ];
    }
    return config;
  },
  images: {
    domains: ["lh3.googleusercontent.com"],
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @covenant/shared ships TypeScript source (main -> ./src/index.ts); transpile it here.
  transpilePackages: ["@covenant/shared"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  webpack: (config) => {
    // @covenant/shared source uses NodeNext-style ".js" import specifiers that
    // actually point at ".ts" files. Let webpack resolve them.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;

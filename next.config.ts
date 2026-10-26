import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TensorFlow.js is a large pure-JS package; load it from node_modules at
  // runtime instead of bundling it into server route handlers.
  serverExternalPackages: ["@tensorflow/tfjs"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages: the trainer runs entirely in the browser.
  output: "export",
  // Served from the root of https://grammatik-trainer.github.io/, so no
  // basePath — vinext 0.0.50 cannot combine one with `output: 'export'`.
  // Emitting directories with an index.html means any static host serves the
  // routes without having to guess at file extensions.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;

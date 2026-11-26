/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfkit reads its font data files from its own folder at runtime, so it must not be bundled.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @react-pdf/renderer is a deep tree of interdependent @react-pdf/*
  // packages (pdfkit fork, fontkit, layout/reconciler, ...) that doesn't
  // reliably survive being bundled by Next's server compiler — it worked
  // fine run directly under plain Node but 500'd once deployed as a
  // Vercel serverless function. Leaving it (and exceljs, same class of
  // package) external means they're resolved as normal node_modules
  // requires at runtime instead of bundled, which is the standard fix for
  // this failure mode.
  serverExternalPackages: ["@react-pdf/renderer", "exceljs"],
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // exceljs stayed external as a precaution after @react-pdf/renderer (a
  // deep tree of interdependent packages) 500'd only once deployed to
  // Vercel despite working fine locally — since replaced by pdf-lib for
  // PDF generation, a single small package with no such issues reported.
  serverExternalPackages: ["exceljs"],
};

module.exports = nextConfig;

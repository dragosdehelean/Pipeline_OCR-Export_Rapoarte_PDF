import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Doc Ingestion & Export",
  description: "Local Docling-only ingestion with strict quality gates"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ro">
      <body className="app-body">{children}</body>
    </html>
  );
}

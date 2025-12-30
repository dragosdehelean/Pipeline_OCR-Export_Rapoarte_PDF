/**
 * @fileoverview App root layout and metadata configuration.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Doc Ingestion & Export",
  description: "Local Docling-only ingestion with strict quality gates"
};

/**
 * Renders the app shell and providers.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body className="app-body">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

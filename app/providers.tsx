/**
 * @fileoverview Client-side providers for shared app context.
 */
"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./_lib/queryClient";

/**
 * Wraps the app in required client-side providers.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

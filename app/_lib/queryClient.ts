/**
 * @fileoverview Provides a shared React Query client configuration.
 */
import { QueryClient } from "@tanstack/react-query";

/**
 * Creates a QueryClient with app-specific defaults.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 30_000,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: false
      }
    }
  });
}

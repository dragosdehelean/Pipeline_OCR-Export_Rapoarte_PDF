/**
 * @fileoverview Test helper for rendering with a React Query client.
 */
import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../../../app/_lib/queryClient";

/**
 * Renders UI wrapped in a fresh QueryClientProvider.
 */
export function renderWithClient(ui: ReactElement, options?: RenderOptions) {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, options);
}

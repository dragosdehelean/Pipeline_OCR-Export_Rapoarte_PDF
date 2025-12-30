import type { ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../../lib/queryClient";

export function renderWithClient(ui: ReactElement, options?: RenderOptions) {
  const client = createQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, options);
}

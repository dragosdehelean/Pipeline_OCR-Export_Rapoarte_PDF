/**
 * @fileoverview Clipboard helpers for E2E preview tests.
 */
import type { Page } from "@playwright/test";

/**
 * Installs a deterministic clipboard mock for copy button assertions.
 */
export async function installClipboardMock(page: Page) {
  // WHY: Avoid touching the OS clipboard while still validating copy flows.
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          clipboardText = text;
        },
        readText: async () => clipboardText
      },
      configurable: true
    });
    (window as Window & { __getClipboardText?: () => string }).__getClipboardText =
      () => clipboardText;
  });
}

/**
 * Reads the mocked clipboard text for assertions.
 */
export async function readClipboardText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as Window & { __getClipboardText?: () => string }).__getClipboardText?.() ??
      ""
  );
}

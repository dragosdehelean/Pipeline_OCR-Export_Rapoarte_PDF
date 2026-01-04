/**
 * @fileoverview Document details page locators for E2E tests.
 */
import type { Locator, Page } from "@playwright/test";

type DocDetailsPage = {
  exportsHeading: Locator;
  downloadMarkdownLink: Locator;
  downloadJsonLink: Locator;
  markdownTab: Locator;
  jsonTab: Locator;
  copyButton: Locator;
  copiedButton: Locator;
  previewContent: Locator;
};

/**
 * Builds document details locators for export preview assertions.
 */
export function createDocDetailsPage(page: Page): DocDetailsPage {
  return {
    exportsHeading: page.getByRole("heading", { name: "Exports" }),
    downloadMarkdownLink: page.getByRole("link", { name: "Download Markdown" }),
    downloadJsonLink: page.getByRole("link", { name: "Download JSON" }),
    markdownTab: page.getByRole("button", { name: "Markdown" }),
    jsonTab: page.getByRole("button", { name: "JSON" }),
    copyButton: page.getByRole("button", { name: "Copy" }),
    copiedButton: page.getByRole("button", { name: "Copied" }),
    previewContent: page.getByTestId("preview-content")
  };
}

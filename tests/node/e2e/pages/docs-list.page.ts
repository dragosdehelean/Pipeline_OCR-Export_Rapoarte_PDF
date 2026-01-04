/**
 * @fileoverview Recent documents list locators for E2E tests.
 */
import type { Locator, Page } from "@playwright/test";

type DocsListPage = {
  searchInput: Locator;
  statusTab: (label: string) => Locator;
  rowByFileName: (fileName: string) => Locator;
};

/**
 * Builds recent documents list locators for the home page.
 */
export function createDocsListPage(page: Page): DocsListPage {
  return {
    searchInput: page.getByRole("searchbox", { name: "Search documents" }),
    statusTab: (label: string) => page.getByRole("tab", { name: label }),
    rowByFileName: (fileName: string) =>
      page.getByRole("row").filter({
        has: page.getByRole("link", { name: fileName })
      })
  };
}

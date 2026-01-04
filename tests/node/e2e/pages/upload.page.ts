/**
 * @fileoverview Upload page locators for E2E tests.
 */
import type { Locator, Page } from "@playwright/test";

type UploadPage = {
  uploadForm: Locator;
  fileInput: Locator;
  uploadButton: Locator;
  clearSelectionButton: Locator;
  advancedToggle: Locator;
  engineSelect: Locator;
  profileSelect: Locator;
  selectedFileSummary: Locator;
  statusRegion: Locator;
};

/**
 * Builds upload page locators for consistent, user-facing selectors.
 */
export function createUploadPage(page: Page): UploadPage {
  const uploadForm = page.getByRole("form", { name: "Upload form" });
  return {
    uploadForm,
    fileInput: page.getByLabel("Choose a file"),
    uploadButton: page.getByRole("button", { name: "Upload" }),
    clearSelectionButton: page.getByRole("button", { name: "Clear selection" }),
    advancedToggle: uploadForm.getByText("Advanced", { exact: true }),
    engineSelect: page.getByRole("combobox", { name: "Engine" }),
    profileSelect: page.getByRole("combobox", { name: "Profile" }),
    selectedFileSummary: page.getByTestId("selected-file"),
    statusRegion: uploadForm.getByRole("status")
  };
}

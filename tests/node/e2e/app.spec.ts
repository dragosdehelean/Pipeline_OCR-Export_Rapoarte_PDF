/**
 * @fileoverview E2E tests for the upload flow and document details UI.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { qualityGatesSchema, type QualityGatesConfig } from "../../../app/_lib/config";

const goodPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "short_valid_text.pdf"
);
const badPdf = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "scan_like_no_text.pdf"
);
const unsupportedFile = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "docs",
  "unsupported.txt"
);
const gatesConfig = qualityGatesSchema.parse(
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "config", "quality-gates.json"),
      "utf-8"
    )
  )
);

const processTimeoutSec = Number(gatesConfig?.limits?.processTimeoutSec);
if (!Number.isFinite(processTimeoutSec) || processTimeoutSec <= 0) {
  throw new Error("Invalid limits.processTimeoutSec in quality-gates.json");
}
const uploadTimeoutMs = Math.min(processTimeoutSec * 1000, 60_000);
const maxFileSizeMb = Number(gatesConfig?.limits?.maxFileSizeMb);
if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0) {
  throw new Error("Invalid limits.maxFileSizeMb in quality-gates.json");
}
const acceptLabel = Array.isArray(gatesConfig?.accept?.extensions)
  ? gatesConfig.accept.extensions.join(", ")
  : "";

function minRequiredForMetric(config: QualityGatesConfig, metric: string) {
  let min = 0;
  for (const gate of config?.gates ?? []) {
    if (!gate?.enabled || gate?.severity !== "FAIL" || gate?.metric !== metric) {
      continue;
    }
    const threshold = Number(gate?.threshold ?? 0);
    if (gate.op === ">") {
      min = Math.max(min, threshold + 1);
    } else if (gate.op === ">=" || gate.op === "==") {
      min = Math.max(min, threshold);
    } else if (gate.op === "!=") {
      min = Math.max(min, threshold + 1);
    }
  }
  return min;
}

const minTextChars = minRequiredForMetric(gatesConfig, "textChars");

async function gotoAndWaitForUploadReady(page: Page) {
  const healthResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/health"),
    { timeout: 30000 }
  );

  await page.goto("/");
  const healthResponse = await healthResponsePromise;
  const healthPayload = await healthResponse.json().catch(() => null);

  if (!healthPayload?.ok) {
    throw new Error(`Health check failed: ${JSON.stringify(healthPayload)}`);
  }
  await page.waitForSelector("input[type='file']", { timeout: 30000 });
}

async function uploadFile(page: Page, filePath: string) {
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: uploadTimeoutMs }
  );

  await page.setInputFiles("input[type=file]", filePath);
  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
  await page.getByRole("button", { name: "Upload" }).click();

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok()).toBeTruthy();
}

async function getDocRow(page: Page, fileName: string) {
  const row = page.locator(".list-item", {
    has: page.getByRole("link", { name: fileName })
  });
  await expect(row).toBeVisible();
  return row;
}

async function getDocId(page: Page, fileName: string) {
  const link = page.getByRole("link", { name: fileName });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) {
    throw new Error(`Missing href for ${fileName}`);
  }
  const parts = href.split("/");
  return parts[parts.length - 1] || "";
}

async function getTextChars(row: Locator) {
  const text = await row.locator("span", { hasText: "Text chars:" }).innerText();
  const match = text.match(/Text chars:\s*(\d+)/);
  return Number(match?.[1] ?? 0);
}

test.describe.serial("quality-critical e2e", () => {
  test("advanced device override is sent", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await page.addInitScript(() => {
      const entries: { name: string; value: string }[] = [];
      const originalAppend = FormData.prototype.append as (
        this: FormData,
        name: string,
        value: string | Blob,
        fileName?: string
      ) => void;
      FormData.prototype.append = function (
        name: string,
        value: string | Blob,
        fileName?: string
      ) {
        entries.push({
          name,
          value: typeof value === "string" ? value : "FILE"
        });
        if (typeof value === "string") {
          return originalAppend.call(this, name, value);
        }
        return originalAppend.call(this, name, value, fileName);
      };
      (window as Window & { __formDataEntries?: { name: string; value: string }[] })
        .__formDataEntries = entries;
    });
    await gotoAndWaitForUploadReady(page);

    await page.getByText("Advanced").click();
    await page.selectOption("#device-override", "cpu");

    await page.setInputFiles("input[type=file]", goodPdf);
    await page.getByRole("button", { name: "Upload" }).click();

    const formEntries = await page.evaluate(
      () =>
        (window as Window & { __formDataEntries?: { name: string; value: string }[] })
          .__formDataEntries ?? []
    );
    const hasDeviceOverride = formEntries.some(
      (entry) => entry.name === "deviceOverride" && entry.value === "cpu"
    );
    expect(hasDeviceOverride).toBeTruthy();
  });

  test("upload good pdf -> SUCCESS -> exports present", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
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

    await gotoAndWaitForUploadReady(page);

    await expect(page.getByText(`Allowed: ${acceptLabel}`)).toBeVisible();
    await expect(page.getByText(`Max file size: ${maxFileSizeMb} MB`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();

    await page.setInputFiles("input[type=file]", unsupportedFile);
    await expect(
      page.getByText(`Unsupported file type. Allowed: ${acceptLabel}.`)
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload" })).toBeDisabled();
    await page.getByRole("button", { name: "Clear selection" }).click();

    await page.setInputFiles("input[type=file]", goodPdf);
    await expect(page.getByTestId("selected-file")).toContainText("short_valid_text.pdf");
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByTestId("selected-file")).toHaveCount(0);

    await page.setInputFiles("input[type=file]", goodPdf);
    await uploadFile(page, goodPdf);

    await expect(page.locator(".alert-title", { hasText: "Processing complete" })).toBeVisible();
    await expect(
      page.getByRole("status").getByRole("link", { name: "View details" })
    ).toBeVisible();

    const goodRow = await getDocRow(page, "short_valid_text.pdf");
    const goodStatus = goodRow.locator(".badge");
    await expect(goodStatus).toBeVisible();
    await expect.poll(
      async () => (await goodStatus.textContent())?.trim(),
      { timeout: uploadTimeoutMs }
    ).toBe("SUCCESS");

    const goodId = await getDocId(page, "short_valid_text.pdf");
    await page.goto(`/docs/${goodId}`);

    await expect(page.getByRole("heading", { name: "Exports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download Markdown" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Markdown" })).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const copiedMarkdown = await page.evaluate(
      () =>
        (window as Window & { __getClipboardText?: () => string }).__getClipboardText?.() ??
        ""
    );
    expect(copiedMarkdown).toContain("Fixture export");

    await page.getByRole("button", { name: "JSON" }).click();
    await page.getByRole("button", { name: "Copy" }).click();
    const copiedJson = await page.evaluate(
      () =>
        (window as Window & { __getClipboardText?: () => string }).__getClipboardText?.() ??
        ""
    );
    expect(copiedJson).toContain("\n  ");
    expect(JSON.parse(copiedJson)).toEqual({ ok: true });

    const previewStyles = await page.evaluate(() => {
      const pre = document.querySelector(".preview-pre");
      if (!pre) {
        return null;
      }
      const styles = getComputedStyle(pre);
      return { maxHeight: styles.maxHeight, overflowY: styles.overflowY };
    });
    expect(previewStyles).not.toBeNull();
    expect(previewStyles?.maxHeight).toBe("420px");
    expect(previewStyles?.overflowY).toBe("auto");

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBeFalsy();

    const mdResponse = await page.request.get(`/api/docs/${goodId}/md`);
    expect(mdResponse.status()).toBe(200);
    const jsonResponse = await page.request.get(`/api/docs/${goodId}/json`);
    expect(jsonResponse.status()).toBe(200);
    const jsonText = await jsonResponse.text();
    expect(jsonText).toContain("\n  ");
    expect(JSON.parse(jsonText)).toEqual({ ok: true });
  });

  test("upload bad pdf -> FAILED -> gates + no exports", async ({ page }) => {
    test.setTimeout(uploadTimeoutMs * 2);
    await gotoAndWaitForUploadReady(page);

    await uploadFile(page, badPdf);

    const badRow = await getDocRow(page, "scan_like_no_text.pdf");
    await expect(badRow.getByText("FAILED")).toBeVisible();

    const goodRow = await getDocRow(page, "short_valid_text.pdf");
    const goodTextChars = await getTextChars(goodRow);
    const badTextChars = await getTextChars(badRow);
    expect(goodTextChars).toBeGreaterThanOrEqual(minTextChars);
    expect(badTextChars).toBeLessThan(minTextChars);

    const searchInput = page.getByRole("searchbox", { name: "Search documents" });
    await searchInput.fill("scan_like");
    await expect(page.getByRole("link", { name: "scan_like_no_text.pdf" })).toBeVisible();
    await expect(page.locator("a", { hasText: "short_valid_text.pdf" })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("tab", { name: "Failed" }).click();
    await expect(page.getByRole("link", { name: "scan_like_no_text.pdf" })).toBeVisible();
    await expect(page.locator("a", { hasText: "short_valid_text.pdf" })).toHaveCount(0);

    const badId = await getDocId(page, "scan_like_no_text.pdf");
    await page.goto(`/docs/${badId}`);
    const gatesSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Quality gates" })
    });
    await expect(gatesSection).toBeVisible();
    const failedCount = await gatesSection.locator(".list-item").count();
    expect(failedCount).toBeGreaterThan(0);

    await expect(page.getByText("No exports available for preview.")).toBeVisible();

    const mdResponse = await page.request.get(`/api/docs/${badId}/md`);
    expect(mdResponse.status()).toBe(404);
    const jsonResponse = await page.request.get(`/api/docs/${badId}/json`);
    expect(jsonResponse.status()).toBe(404);
  });
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const goodPdf = path.join(
  process.cwd(),
  "fixtures",
  "docs",
  "short_valid_text.pdf"
);
const badPdf = path.join(
  process.cwd(),
  "fixtures",
  "docs",
  "scan_like_no_text.pdf"
);
const gatesConfig = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "config", "quality-gates.json"),
    "utf-8"
  )
);

const processTimeoutSec = Number(gatesConfig?.limits?.processTimeoutSec);
if (!Number.isFinite(processTimeoutSec) || processTimeoutSec <= 0) {
  throw new Error("Invalid limits.processTimeoutSec in quality-gates.json");
}
const uploadTimeoutMs = processTimeoutSec * 1000;

function minRequiredForMetric(config: any, metric: string) {
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

  await page.waitForFunction(
    () => {
      const button = document.querySelector("button[type='submit']");
      return !!button && !button.hasAttribute("disabled");
    },
    null,
    { timeout: 30000 }
  );
}

async function uploadFile(page: Page, filePath: string) {
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/upload") &&
      response.request().method() === "POST",
    { timeout: uploadTimeoutMs }
  );

  await page.setInputFiles("input[type=file]", filePath);
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
  test.setTimeout(uploadTimeoutMs * 2);

  test("upload good pdf -> SUCCESS -> exports present", async ({ page }) => {
    await gotoAndWaitForUploadReady(page);

    await uploadFile(page, goodPdf);

    const goodRow = await getDocRow(page, "short_valid_text.pdf");
    await expect(goodRow.getByText("SUCCESS")).toBeVisible();

    const goodId = await getDocId(page, "short_valid_text.pdf");
    await page.getByRole("link", { name: "short_valid_text.pdf" }).click();

    await expect(page.getByRole("heading", { name: "Exports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Markdown" })).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON" })).toBeVisible();

    const mdResponse = await page.request.get(`/api/docs/${goodId}/md`);
    expect(mdResponse.status()).toBe(200);
    const jsonResponse = await page.request.get(`/api/docs/${goodId}/json`);
    expect(jsonResponse.status()).toBe(200);
  });

  test("upload bad pdf -> FAILED -> gates + no exports", async ({ page }) => {
    await gotoAndWaitForUploadReady(page);

    await uploadFile(page, badPdf);

    const badRow = await getDocRow(page, "scan_like_no_text.pdf");
    await expect(badRow.getByText("FAILED")).toBeVisible();

    const goodRow = await getDocRow(page, "short_valid_text.pdf");
    const goodTextChars = await getTextChars(goodRow);
    const badTextChars = await getTextChars(badRow);
    expect(goodTextChars).toBeGreaterThanOrEqual(minTextChars);
    expect(badTextChars).toBeLessThan(minTextChars);

    const badId = await getDocId(page, "scan_like_no_text.pdf");
    await page.getByRole("link", { name: "scan_like_no_text.pdf" }).click();

    await expect(page).toHaveURL(/\/docs\//);
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

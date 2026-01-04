/**
 * @fileoverview Validates that uploads return a document id.
 *
 * Coverage: Upload API response payload basics.
 * Dependencies: Next.js dev server, Python worker.
 * Run time: ~30 sec.
 */
import { expect, test } from "@playwright/test";
import { FIXTURES } from "../../config/test-config";
import { deleteDoc } from "../../helpers/docs.helper";
import { buildUploadFilePayload } from "../../helpers/fixtures.helper";
import { gotoUploadPage, uploadFile } from "../../helpers/upload.helper";

test.describe.configure({ mode: "parallel" });

test("upload accepts PDF and returns document id", async ({ page }, testInfo) => {
  await gotoUploadPage(page);

  const { payload } = await buildUploadFilePayload(FIXTURES.goodPdf, testInfo);
  const response = await uploadFile(page, payload);
  expect(response.ok()).toBeTruthy();

  const uploadPayload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const docId =
    typeof uploadPayload?.id === "string"
      ? uploadPayload.id
      : typeof uploadPayload?.docId === "string"
        ? uploadPayload.docId
        : "";
  expect(docId).toBeTruthy();

  await deleteDoc(page, docId);
});

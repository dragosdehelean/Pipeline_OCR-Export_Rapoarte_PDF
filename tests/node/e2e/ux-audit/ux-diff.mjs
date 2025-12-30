import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const rootDir = process.cwd();
const auditDir = path.join(rootDir, "tests", "node", "e2e", "ux-audit");
const beforeDir = path.join(auditDir, "before");
const afterDir = path.join(auditDir, "after");
const diffDir = path.join(auditDir, "diff");

function listPngFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".png"));
}

function readPng(filePath) {
  const data = fs.readFileSync(filePath);
  return PNG.sync.read(data);
}

function writePng(filePath, png) {
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filePath, buffer);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function diffPng(beforePath, afterPath, outputPath) {
  const before = readPng(beforePath);
  const after = readPng(afterPath);

  const targetWidth = Math.max(before.width, after.width);
  const targetHeight = Math.max(before.height, after.height);
  const needsPadding = before.width !== after.width || before.height !== after.height;
  const beforePadded = needsPadding ? padPng(before, targetWidth, targetHeight) : before;
  const afterPadded = needsPadding ? padPng(after, targetWidth, targetHeight) : after;

  const diff = new PNG({ width: targetWidth, height: targetHeight });
  const mismatch = pixelmatch(
    beforePadded.data,
    afterPadded.data,
    diff.data,
    targetWidth,
    targetHeight,
    {
      threshold: 0.1,
      includeAA: true,
    }
  );

  writePng(outputPath, diff);
  return mismatch;
}

function padPng(source, width, height) {
  const output = new PNG({ width, height });
  output.data.fill(255);
  PNG.bitblt(source, output, 0, 0, source.width, source.height, 0, 0);
  return output;
}

function main() {
  const beforeFiles = listPngFiles(beforeDir);
  const afterFiles = listPngFiles(afterDir);

  if (beforeFiles.length === 0 || afterFiles.length === 0) {
    console.error("Missing before/after screenshots. Run the audit spec first.");
    process.exitCode = 1;
    return;
  }

  ensureDir(diffDir);

  const beforeSet = new Set(beforeFiles);
  const afterSet = new Set(afterFiles);
  const shared = beforeFiles.filter((file) => afterSet.has(file));
  const missingAfter = beforeFiles.filter((file) => !afterSet.has(file));
  const missingBefore = afterFiles.filter((file) => !beforeSet.has(file));

  let totalMismatches = 0;
  for (const file of shared) {
    const beforePath = path.join(beforeDir, file);
    const afterPath = path.join(afterDir, file);
    const diffPath = path.join(diffDir, file.replace(".png", "__diff.png"));
    const mismatches = diffPng(beforePath, afterPath, diffPath);
    totalMismatches += mismatches;
  }

  if (missingAfter.length > 0) {
    console.warn(`Missing after screenshots for: ${missingAfter.join(", ")}`);
  }
  if (missingBefore.length > 0) {
    console.warn(`Missing before screenshots for: ${missingBefore.join(", ")}`);
  }

  console.log(`Diffs generated: ${shared.length}, total mismatched pixels: ${totalMismatches}`);
}

main();

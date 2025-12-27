import fs from "fs/promises";
import path from "path";

export default async function globalSetup() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  await fs.rm(dataDir, { recursive: true, force: true });
}

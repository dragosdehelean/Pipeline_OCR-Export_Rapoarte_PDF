import fs from "fs/promises";
import path from "path";
import { z } from "zod";

const gateSchema = z
  .object({
    code: z.string(),
    enabled: z.boolean(),
    severity: z.string(),
    metric: z.string(),
    op: z.string(),
    threshold: z.number(),
    message: z.string()
  })
  .strict();

const qualityGatesSchema = z
  .object({
    version: z.number(),
    strict: z.boolean(),
    accept: z
      .object({
        mimeTypes: z.array(z.string()),
        extensions: z.array(z.string())
      })
      .strict(),
    limits: z
      .object({
        maxFileSizeMb: z.number(),
        maxPages: z.number(),
        processTimeoutSec: z.number(),
        stdoutTailKb: z.number(),
        stderrTailKb: z.number()
      })
      .strict(),
    quality: z
      .object({
        minTextChars: z.number(),
        minTextCharsPerPageAvg: z.number(),
        minTextItems: z.number(),
        minMarkdownChars: z.number(),
        minTables: z.number()
      })
      .strict(),
    gates: z.array(gateSchema)
  })
  .strict();

export type QualityGatesConfig = z.infer<typeof qualityGatesSchema>;

let cachedConfig: QualityGatesConfig | null = null;

export function getGatesConfigPath(): string {
  return (
    process.env.GATES_CONFIG_PATH ||
    path.join(process.cwd(), "config", "quality-gates.json")
  );
}

export async function loadQualityGatesConfig(): Promise<QualityGatesConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getGatesConfigPath();
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = qualityGatesSchema.parse(JSON.parse(raw));
  cachedConfig = parsed;
  return parsed;
}

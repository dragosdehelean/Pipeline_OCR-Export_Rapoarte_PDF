/**
 * @fileoverview Loads and validates quality gates and Docling config files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const gateSchema = z
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

export const qualityGatesSchema = z
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
let cachedDoclingConfig: DoclingConfig | null = null;

const doclingProfileSchema = z
  .object({
    pdfBackend: z.string(),
    doOcr: z.boolean(),
    doTableStructure: z.boolean(),
    tableStructureMode: z.string(),
    documentTimeoutSec: z.number()
  })
  .strict();

export const doclingConfigSchema = z
  .object({
    version: z.number(),
    defaultProfile: z.string(),
    profiles: z.record(doclingProfileSchema),
    preflight: z
      .object({
        pdfText: z
          .object({
            enabled: z.boolean(),
            samplePages: z.number(),
            minTextChars: z.number(),
            minTextCharsPerPageAvg: z.number()
          })
          .strict()
      })
      .strict(),
    docling: z
      .object({
        accelerator: z.string()
      })
      .strict()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.profiles[value.defaultProfile]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultProfile "${value.defaultProfile}" is missing from profiles.`,
        path: ["defaultProfile"]
      });
    }
  });

export type DoclingConfig = z.infer<typeof doclingConfigSchema>;

/**
 * Resolves the quality gates config path from env or defaults.
 */
export function getGatesConfigPath(): string {
  return (
    process.env.GATES_CONFIG_PATH ||
    path.join(process.cwd(), "config", "quality-gates.json")
  );
}

/**
 * Resolves the Docling config path from env or defaults.
 */
export function getDoclingConfigPath(): string {
  return (
    process.env.DOCLING_CONFIG_PATH ||
    path.join(process.cwd(), "config", "docling.json")
  );
}

/**
 * Loads and caches the parsed quality gates config.
 */
export async function loadQualityGatesConfig(): Promise<QualityGatesConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getGatesConfigPath();
  const raw = await fs.readFile(configPath, "utf-8");
  const parsedJson = JSON.parse(raw) as Record<string, unknown>;
  const hasLegacyKeys =
    typeof parsedJson === "object" &&
    parsedJson !== null &&
    ("preflight" in parsedJson || "docling" in parsedJson);
  if (hasLegacyKeys) {
    console.warn(
      "[config] Deprecated docling/preflight keys found in quality-gates.json. Move them to config/docling.json."
    );
    delete parsedJson.preflight;
    delete parsedJson.docling;
  }
  const parsed = qualityGatesSchema.parse(parsedJson);
  cachedConfig = parsed;
  return parsed;
}

/**
 * Loads and caches the parsed Docling config.
 */
export async function loadDoclingConfig(): Promise<DoclingConfig> {
  if (cachedDoclingConfig) {
    return cachedDoclingConfig;
  }

  const configPath = getDoclingConfigPath();
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = doclingConfigSchema.parse(JSON.parse(raw));
  cachedDoclingConfig = parsed;
  return parsed;
}

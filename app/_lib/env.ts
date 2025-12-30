/**
 * @fileoverview Resolves and validates required runtime environment values.
 */
const requiredEnvKeys = [
  "PYTHON_BIN",
  "DOCLING_WORKER",
  "DATA_DIR",
  "GATES_CONFIG_PATH"
] as const;

export type RequiredEnvKey = (typeof requiredEnvKeys)[number];

/**
 * Returns the list of required environment variable keys.
 */
export function getRequiredEnvKeys(): RequiredEnvKey[] {
  return [...requiredEnvKeys];
}

/**
 * Resolves a required env var or returns null when missing/blank.
 */
export function resolveEnvValue(key: RequiredEnvKey): string | null {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw;
}

/**
 * Lists required env vars that are missing or empty.
 */
export function getMissingEnv(): string[] {
  return requiredEnvKeys.filter((key) => resolveEnvValue(key) === null);
}

/**
 * Returns the env values needed by the worker runtime.
 */
export function getResolvedRuntimeEnv(): {
  PYTHON_BIN: string | null;
  DOCLING_WORKER: string | null;
} {
  return {
    PYTHON_BIN: resolveEnvValue("PYTHON_BIN"),
    DOCLING_WORKER: resolveEnvValue("DOCLING_WORKER")
  };
}

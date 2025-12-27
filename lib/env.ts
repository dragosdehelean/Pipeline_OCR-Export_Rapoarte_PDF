const requiredEnvKeys = [
  "PYTHON_BIN",
  "DOCLING_WORKER",
  "DATA_DIR",
  "GATES_CONFIG_PATH"
] as const;

export type RequiredEnvKey = (typeof requiredEnvKeys)[number];

export function getRequiredEnvKeys(): RequiredEnvKey[] {
  return [...requiredEnvKeys];
}

export function resolveEnvValue(key: RequiredEnvKey): string | null {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw;
}

export function getMissingEnv(): string[] {
  return requiredEnvKeys.filter((key) => resolveEnvValue(key) === null);
}

export function getResolvedRuntimeEnv(): {
  PYTHON_BIN: string | null;
  DOCLING_WORKER: string | null;
} {
  return {
    PYTHON_BIN: resolveEnvValue("PYTHON_BIN"),
    DOCLING_WORKER: resolveEnvValue("DOCLING_WORKER")
  };
}

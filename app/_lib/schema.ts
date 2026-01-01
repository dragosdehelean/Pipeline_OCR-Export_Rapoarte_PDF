/**
 * @fileoverview Defines Zod schemas and types for meta.json contracts.
 */
import { z } from "zod";

export const mimeTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export const docStatusSchema = z.enum(["PENDING", "SUCCESS", "FAILED"]);

export const metricsSchema = z
  .object({
    pages: z.number(),
    textChars: z.number(),
    mdChars: z.number(),
    textItems: z.number(),
    tables: z.number(),
    textCharsPerPageAvg: z.number(),
    splitSpacing: z
      .object({
        score: z.number(),
        suspicious: z.boolean(),
        singleCharTokenRatio: z.number().optional(),
        singleCharRuns: z.number().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const failedGateSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    actual: z.number(),
    expectedOp: z.string(),
    expected: z.number()
  })
  .strict();

export const qualityGateEvaluationSchema = z
  .object({
    code: z.string(),
    actual: z.number(),
    passed: z.boolean(),
    severity: z.enum(["FAIL", "WARN"]).optional(),
    metric: z.string().optional(),
    op: z.string().optional(),
    threshold: z.number().optional(),
    expectedOp: z.string().optional(),
    expected: z.number().optional(),
    message: z.string().optional()
  })
  .strict();

export const metaSourceSchema = z
  .object({
    originalFileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    sha256: z.string(),
    storedPath: z.string()
  })
  .strict();

export const processingFailureSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional()
  })
  .strict();

export const processingDoclingSchema = z
  .object({
    pdfBackend: z.string(),
    doOcr: z.boolean(),
    doTableStructure: z.boolean(),
    doCellMatching: z.boolean().optional(),
    tableStructureMode: z.string(),
    documentTimeoutSec: z.number(),
    accelerator: z.string()
  })
  .strict();

export const doclingRequestedSchema = z
  .object({
    profile: z.string(),
    pdfBackendRequested: z.string(),
    tableModeRequested: z.string(),
    doCellMatchingRequested: z.boolean().nullable().optional()
  })
  .strict();

export const doclingEffectiveSchema = z
  .object({
    doclingVersion: z.string(),
    pdfBackendEffective: z.string(),
    tableModeEffective: z.string(),
    doCellMatchingEffective: z.boolean().nullable().optional(),
    acceleratorEffective: z.string().optional(),
    fallbackReasons: z.array(z.string()).optional()
  })
  .strict();

export const doclingCapabilitiesSchema = z
  .object({
    doclingVersion: z.string(),
    pdfBackends: z.array(z.string()),
    tableModes: z.array(z.string()),
    tableStructureOptionsFields: z.array(z.string()).optional(),
    cudaAvailable: z.boolean().nullable().optional(),
    gpuName: z.string().nullable().optional(),
    torchVersion: z.string().nullable().optional(),
    torchCudaVersion: z.string().nullable().optional()
  })
  .strict();

export const metaDoclingSchema = z
  .object({
    requested: doclingRequestedSchema,
    effective: doclingEffectiveSchema,
    capabilities: doclingCapabilitiesSchema.optional()
  })
  .strict();

export const metaEngineSchema = z
  .object({
    requested: z.record(z.string(), z.unknown()),
    effective: z.record(z.string(), z.unknown()),
    capabilities: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const processingAcceleratorSchema = z
  .object({
    requestedDevice: z.string(),
    effectiveDevice: z.string(),
    cudaAvailable: z.boolean(),
    reason: z.string().optional(),
    torchVersion: z.string().optional(),
    torchCudaVersion: z.string().optional()
  })
  .strict();

export const processingPreflightSchema = z
  .object({
    passed: z.boolean(),
    samplePages: z.number(),
    textChars: z.number(),
    textCharsPerPageAvg: z.number(),
    error: z.string().optional()
  })
  .strict();

export const processingTimingsSchema = z
  .object({
    pythonStartupMs: z.number().optional(),
    preflightMs: z.number().optional(),
    doclingConvertMs: z.number().optional(),
    exportMs: z.number().optional()
  })
  .strict();

export const metaProcessingSchema = z
  .object({
    status: docStatusSchema,
    stage: z.string().optional(),
    progress: z.number().optional(),
    message: z.string().optional(),
    requestId: z.string().optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().nullable().optional(),
    durationMs: z.number().optional(),
    timeoutSec: z.number().optional(),
    exitCode: z.number().optional(),
    selectedProfile: z.string().optional(),
    profile: z.string().optional(),
    failure: processingFailureSchema.optional(),
    docling: processingDoclingSchema.optional(),
    accelerator: processingAcceleratorSchema.optional(),
    preflight: processingPreflightSchema.optional(),
    timings: processingTimingsSchema.optional(),
    worker: z
      .object({
        pythonBin: z.string(),
        pythonVersion: z.string(),
        doclingVersion: z.string()
      })
      .optional()
  })
  .strict();

export const metaOutputsSchema = z
  .object({
    markdownPath: z.string().nullable(),
    jsonPath: z.string().nullable(),
    bytes: z
      .object({
        markdown: z.number(),
        json: z.number()
      })
      .strict()
  })
  .strict();

export const metaQualityGatesSchema = z
  .object({
    configVersion: z.number().optional(),
    strict: z.boolean().optional(),
    passed: z.boolean().optional(),
    failedGates: z.array(failedGateSchema),
    evaluated: z.array(qualityGateEvaluationSchema)
  })
  .strict();

export const metaLogsSchema = z
  .object({
    stdoutTail: z.string(),
    stderrTail: z.string()
  })
  .strict();

export const metaFileSchema = z
  .object({
    schemaVersion: z.number().optional(),
    id: z.string(),
    requestId: z.string().optional(),
    createdAt: z.string().optional(),
    source: metaSourceSchema,
    processing: metaProcessingSchema,
    docling: metaDoclingSchema.optional(),
    engine: metaEngineSchema.optional(),
    outputs: metaOutputsSchema,
    metrics: metricsSchema,
    qualityGates: metaQualityGatesSchema,
    logs: metaLogsSchema
  })
  .strict();

export const docMetaSchema = z
  .object({
    id: z.string(),
    originalFileName: z.string(),
    mimeType: mimeTypeSchema,
    createdAt: z.string(),
    status: docStatusSchema,
    metrics: metricsSchema,
    failedGates: z.array(failedGateSchema),
    logs: metaLogsSchema
  })
  .strict();

export const docsIndexSchema = z
  .object({
    docs: z.array(docMetaSchema)
  })
  .strict();

export type DocMeta = z.infer<typeof docMetaSchema>;
export type Metrics = z.infer<typeof metricsSchema>;
export type FailedGate = z.infer<typeof failedGateSchema>;
export type DocStatus = z.infer<typeof docStatusSchema>;
export type MetaFile = z.infer<typeof metaFileSchema>;
export type QualityGateEvaluation = z.infer<typeof qualityGateEvaluationSchema>;
export type DocsIndex = z.infer<typeof docsIndexSchema>;

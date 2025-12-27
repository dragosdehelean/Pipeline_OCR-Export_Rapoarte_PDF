import { z } from "zod";

export const metricsSchema = z.object({
  pages: z.number(),
  textChars: z.number(),
  mdChars: z.number(),
  textItems: z.number(),
  tables: z.number(),
  textCharsPerPageAvg: z.number()
});

export const failedGateSchema = z.object({
  code: z.string(),
  message: z.string(),
  actual: z.number(),
  expectedOp: z.string(),
  expected: z.number()
});

export const docMetaSchema = z.object({
  id: z.string(),
  originalFileName: z.string(),
  mimeType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]),
  createdAt: z.string(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]),
  metrics: metricsSchema,
  failedGates: z.array(failedGateSchema),
  logs: z.object({
    stdoutTail: z.string(),
    stderrTail: z.string()
  })
});

export type DocMeta = z.infer<typeof docMetaSchema>;
export type Metrics = z.infer<typeof metricsSchema>;
export type FailedGate = z.infer<typeof failedGateSchema>;

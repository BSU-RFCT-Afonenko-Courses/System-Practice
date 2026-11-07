import { collectNativeProjectFacts } from "../document/project-capture.ts";
import { assertNativeAssignmentCapture } from "../runtime/operation.ts";
import { normalizeDocument } from "../public.ts";
import {
  boundDocument,
  decodeDocumentContext,
  ExerciseDeclarationSchema,
  PandocDocumentSchema,
} from "../document/contracts.ts";
import { nativeMetadata } from "../release/collect.ts";
import { NativePendingDocumentContextSchema } from "../runtime/contracts.ts";
import { decode } from "../document/contracts.ts";
import { isRecord } from "../document/native-ast.ts";
import type { AssignmentNormalization } from "../document/assignment-contracts.ts";
import { fail } from "../contracts/project.ts";
/** Quarto наследует отдельные metadata keys; TS декодирует прежние flat defaults. */
function exerciseDefaults(meta: Record<string, unknown>, input: string) {
  if (Object.hasOwn(meta, "exercise-defaults")) {
    fail(
      "CORE.METADATA_INVALID",
      "Используйте default-exercise-* вместо exercise-defaults",
      input,
    );
  }
  const schema = ExerciseDeclarationSchema.omit({ project: true }).partial();
  const defaults = Object.fromEntries(
    Object.entries(meta)
      .filter(([key]) => key.startsWith("default-exercise-"))
      .map(([key, node]) =>
        [key.slice("default-exercise-".length), nativeMetadata(node)] as const
      )
      .filter(([key, value]) =>
        value !== false || !Object.hasOwn(schema.shape, key)
      )
      .map((
        [key, value],
      ) => [
        key,
        key === "time" && typeof value === "string" ? Number(value) : value,
      ]),
  );
  return decode(schema, defaults, "CORE.METADATA_INVALID", input);
}
const chunks: Uint8Array[] = [];
let length = 0;
for await (const chunk of Deno.stdin.readable) {
  length += chunk.length;
  if (length > 16 * 1024 * 1024) {
    fail("DOCUMENT_LIMIT", "JSON input больше16MiB");
  }
  chunks.push(chunk);
}
const bytes = new Uint8Array(length);
let offset = 0;
for (const chunk of chunks) {
  bytes.set(chunk, offset);
  offset += chunk.length;
}
const rawAst: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
boundDocument(rawAst);
const ast = decode(PandocDocumentSchema, rawAst, "DOCUMENT_AST");
const requestMetadata = ast.meta?.["course-core-ts-request"];
const runPath = Deno.env.get("COURSE_CORE_TS_RUN") ??
  (isRecord(requestMetadata) && requestMetadata.t === "MetaString" ? requestMetadata.c : undefined);
if (typeof runPath !== "string") {
  fail("DOCUMENT_CONTEXT", "Отсутствует native request");
}
const request: unknown = JSON.parse(await Deno.readTextFile(runPath));
if (!isRecord(request)) fail("DOCUMENT_CONTEXT", "Нужен native request object");
const requestedContext = Deno.env.get("COURSE_CORE_TS_RUN")
    ? decodeDocumentContext(request.context)
    : decode(
      NativePendingDocumentContextSchema,
      request.context,
      "DOCUMENT_BINDING",
    );
if (typeof request.capture !== "string" || !request.capture.startsWith("/")) {
  fail("DOCUMENT_CONTEXT", "Нужен абсолютный capture path");
}
delete ast.meta["course-core-ts-request"];
const transport = ast.meta?.["course-core-ts-context"];
if (!isRecord(transport) || transport.t !== "MetaString" || typeof transport.c !== "string") {
  fail("DOCUMENT_BINDING", "Отсутствует native context");
}
const nativeContext = decodeDocumentContext(JSON.parse(transport.c));
const boundContext = decodeDocumentContext(
  Deno.env.get("COURSE_CORE_TS_RUN")
    ? requestedContext
    : decodeDocumentContext({
      ...requestedContext,
      format: nativeContext.format,
      exerciseBank: nativeContext.exerciseBank,
      defaults: nativeContext.defaults,
    }),
);
if (JSON.stringify(nativeContext) !== JSON.stringify(boundContext)) {
  fail("DOCUMENT_BINDING", "Native context не соответствует request");
}
delete ast.meta["course-core-ts-context"];
const context = Deno.env.get("COURSE_CORE_TS_RUN")
  ? boundContext
  : decodeDocumentContext({
    ...boundContext,
    defaults: exerciseDefaults(ast.meta, boundContext.input),
  });
function isAssignment(value: unknown): value is AssignmentNormalization {
  return isRecord(value) && typeof value.source === "string" && Array.isArray(value.assessments) && value.assessments.every((row: unknown) => isRecord(row) && typeof row.source === "string" && typeof row.id === "string");
}
const assignment = request.assignment;
if (assignment !== undefined && !isAssignment(assignment)) fail("DOCUMENT_CONTEXT", "Повреждённый assignment request");
let assignmentOwner: string | undefined;
if (assignment) {
  assignmentOwner = await assertNativeAssignmentCapture(
    context,
    assignment,
    request.capture,
  );
}
const early = normalizeDocument(ast, context, assignment);
try {
  await Deno.writeTextFile(
    request.capture + ".early.json",
    JSON.stringify(early),
    { createNew: true },
  );
} catch (error) {
  if (error instanceof Deno.errors.AlreadyExists) {
    fail("DOCUMENT_BINDING", "Early sidecar уже существует", context.input);
  }
  throw error;
}
if (assignment) {
  const facts = collectNativeProjectFacts(early, assignmentOwner!);
  try {
    await Deno.writeTextFile(
      request.capture + ".project-facts.json",
      JSON.stringify(facts),
      { createNew: true, mode: 0o600 },
    );
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      fail(
        "DOCUMENT_BINDING",
        "Project facts sidecar уже существует",
        context.input,
      );
    }
    throw error;
  }
}
await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(early.ast)));

import { relative } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { decode } from "../document/contracts.ts";
import { assertArtifactTarget } from "../artifacts/project.ts";
import { toolCachePath } from "../infrastructure/tool-cache.ts";
import {
  NativeResourceFilesSchema,
  NativeResourceRequestSchema,
} from "./contracts.ts";
import type { NativeResourceRequest } from "./contracts.ts";
import { nativeResourceHandleIdentity } from "./native-output-resources.ts";
import { regular } from "./source-paths.ts";
import type { CompleteOperation } from "./operation-store.ts";

const privateParts =
  /(^|\/)(?:private|reference|solution|solutions|grading-notes|rubric\.md|contract\.md|closed-tests|tests)(\/|$)/i;
const sourcePart =
  /(^|\/)(?:\.[^/]+|_extensions|_freeze|_generated|_site|_book|_output|site_libs|node_modules|build|target|out|__pycache__)(\/|$)|(^|\/)(?:_quarto(?:[-.]|$)|_metadata\.ya?ml$)|\.(?:qmd|rmd|ipynb|class|jar|ya?ml|lua|ts|cue|r|py|sh|toml)$/i;
export const ordinaryResourcePath = (path: string) =>
  !privateParts.test(path) && !sourcePart.test(path) &&
  !/(^|\/)check\.sh$/.test(path);
/** A callback-local byte cache; authority and expiry belong to the operation scope. */
export function operationResourceReader(
  complete: CompleteOperation,
  scope: {
    guard(): Promise<void>;
    readonly metrics: { resourceByteReads: number; resourceCacheHits: number };
  },
) {
  const { guard, metrics } = scope;
  const capturedResources = new Map<
    string,
    { bytes: Uint8Array; identity: string }
  >();
  const capturedPhysicalResources = new Map<string, Promise<Uint8Array>>();
  const resourcesBySource = new Map(
    complete.resources.map((row) => [row.source, row]),
  );
  async function resourceFiles(
    value: NativeResourceRequest,
    assertIdentity?: (identity: string) => void,
  ) {
    const request = decode(
      NativeResourceRequestSchema,
      value,
      "RESOURCE_PATH",
    );
    await guard();
    const targets = new Set<string>(), files = [];
    let awaitedBytes = false;
    for (const file of request.files) {
      assertArtifactTarget(
        file.target,
        complete.state.projection === "student" ? "student" : "full",
        complete.state.root,
      );
      if (
        targets.has(file.target) ||
        [...targets].some((t) =>
          t.startsWith(file.target + "/") || file.target.startsWith(t + "/")
        )
      ) fail("ARTIFACT_COLLISION", "Повторный ресурсный target");
      targets.add(file.target);
      const row = resourcesBySource.get(file.source);
      if (
        !ordinaryResourcePath(file.source) ||
        toolCachePath(complete.state.root, file.source) || !row
      ) {
        fail(
          "RESOURCE_PRIVATE_OR_SOURCE",
          "Файл не является видимым обычным native ресурсом",
        );
      }
      let captured = capturedResources.get(file.source);
      if (!captured) {
        const actual = await regular(
          complete.state.root,
          relative(complete.state.root, row.path),
        );
        const opened = await Deno.open(actual, { read: true });
        try {
          const identity = await nativeResourceHandleIdentity(
            complete.state.root,
            actual,
            opened,
          );
          assertIdentity?.(identity);
          let reading = capturedPhysicalResources.get(identity);
          if (!reading) {
            metrics.resourceByteReads++;
            reading = new Response(opened.readable).arrayBuffer().then(
              (buffer) => new Uint8Array(buffer),
            );
            // Publish before awaiting so aliases and concurrent calls share one read.
            capturedPhysicalResources.set(identity, reading);
            const pending = reading;
            void pending.catch(() => {
              if (capturedPhysicalResources.get(identity) === pending) {
                capturedPhysicalResources.delete(identity);
              }
            });
          } else metrics.resourceCacheHits++;
          // Every waiter retains its own lifecycle/role checks and byte copy.
          awaitedBytes = true;
          const bytes = await reading;
          captured = { bytes, identity };
          capturedResources.set(file.source, captured);
          row.identity = identity;
        } finally {
          // FsFile.readable закрывает handle после EOF; cache hit закрываем здесь.
          try {
            opened.close();
          } catch (error) {
            if (!(error instanceof Deno.errors.BadResource)) throw error;
          }
        }
      } else {
        metrics.resourceCacheHits++;
        assertIdentity?.(captured.identity);
      }
      files.push({
        source: file.source,
        target: file.target,
        bytes: new Uint8Array(captured.bytes),
      });
    }
    // Every caller awaiting shared bytes checks its own callback lifetime.
    if (awaitedBytes) await guard();
    return NativeResourceFilesSchema.parse({
      audience: complete.state.projection === "student" ? "student" : "full",
      files,
    });
  }
  return resourceFiles;
}

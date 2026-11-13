import { createMetrics as __createMetrics } from "../observability/bridge.ts";
const __metrics = __createMetrics("reference-catalog");
import { join, resolve, relative, isAbsolute, dirname, fromFileUrl } from "stdlib/path";
export { join, resolve, relative, isAbsolute, dirname, fromFileUrl };
async function existsImpl(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function filesImpl(root: string): Promise<string[]> {
  const out: string[] = [];
  for await (const item of Deno.readDir(root)) {
    if (item.isSymlink)
      throw new Error(
        `QRC символические ссылки в результатах сборки не поддерживаются: ${join(root, item.name)}`,
      );
    const path = join(root, item.name);
    if (item.isDirectory) out.push(...(await files(path)));
    else if (item.isFile) out.push(path);
  }
  return out.sort();
}

export const exists = __metrics.wrapAsync(
  { id: "reference-catalog.infrastructure.files.exists", kind: "io" },
  existsImpl,
);
export const files = __metrics.wrapAsync(
  { id: "reference-catalog.infrastructure.files.files", kind: "io" },
  filesImpl,
);

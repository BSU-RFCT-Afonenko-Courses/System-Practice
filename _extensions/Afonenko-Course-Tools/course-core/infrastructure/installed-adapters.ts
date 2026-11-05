import { join } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { regular } from "../runtime/source-paths.ts";
/** Контракты двух штатных layouts установки; файлы расширений не инвентаризуются. */
export async function installedNativeAdapters(root: string): Promise<string[]> {
  const names: string[] = [];
  async function directories(path: string): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const entry of Deno.readDir(join(root, path))) {
        if (entry.isDirectory) names.push(path + "/" + entry.name);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return names;
  }
  async function read(path: string): Promise<boolean> {
    let contract: unknown;
    try {
      contract = JSON.parse(
        await Deno.readTextFile(await regular(root, path + "/contract.json")),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
    if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
      fail("CORE.ADAPTER_INVALID", "Некорректный installed adapter contract");
    }
    if ("name" in contract && typeof contract.name === "string") {
      if (names.includes(contract.name)) {
        fail(
          "CORE.ADAPTER_INVALID",
          "Повторный installed adapter " + contract.name,
        );
      }
      names.push(contract.name);
    }
    return true;
  }
  for (const path of await directories("_extensions")) {
    if (await read(path)) continue;
    for (const nested of await directories(path)) await read(nested);
  }
  return names;
}

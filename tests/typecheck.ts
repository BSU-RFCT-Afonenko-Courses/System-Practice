// Штатный Quarto stdlib и точный встроенный JS проверяются без копии исходников в репозитории.
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const config: unknown = JSON.parse(
  await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
);
if (!record(config) || !record(config.compilerOptions)) {
  throw Error("Неверная конфигурация строгой проверки типов");
}
const html = await Deno.readTextFile(
  new URL("../includes/reveal-layout.html", import.meta.url),
);
const script = /^<script>\r?\n([\s\S]*?)<\/script>\s*$/.exec(html)?.[1];
if (!script) throw Error("Ожидался один встроенный script в reveal-layout.html");
const imports: Record<string, string> = {};
for (const key of ["stdlib/path", "stdlib/fs"]) {
  imports[key] = import.meta.resolve(key).replace(
    /^https:\/\/jsr\.io\/@std\/(path|fs)\/([^/]+)\/mod\.ts$/,
    "jsr:@std/$1@$2",
  );
}
const temporary = await Deno.makeTempDir({ prefix: "system-practice-types-" });
async function check(configPath: string, sources: string[]): Promise<boolean> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["check", "--no-lock", "--config", configPath, ...sources],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) Deno.exitCode = result.code;
  return result.success;
}
try {
  const javascript = `${temporary}/reveal-layout.js`;
  const browserConfig = `${temporary}/browser.json`;
  await Deno.writeTextFile(javascript, script);
  await Deno.writeTextFile(browserConfig, JSON.stringify({
    compilerOptions: {
      ...config.compilerOptions,
      checkJs: true,
      lib: ["dom", "dom.iterable", "esnext"],
    },
    lock: false,
  }));
  if (await check(browserConfig, [javascript])) {
    const typescriptConfig = `${temporary}/typescript.json`;
    await Deno.writeTextFile(typescriptConfig, JSON.stringify({ ...config, imports, lock: false }));
    const sources = ["project-paths.ts", "typecheck.ts"].map((name) =>
      fileURLToPath(new URL(name, import.meta.url))
    );
    if (await check(typescriptConfig, sources)) {
      console.log(JSON.stringify({ checked: sources.length, embedded: 1, strict: true }));
    }
  }
} finally {
  await Deno.remove(temporary, { recursive: true });
}

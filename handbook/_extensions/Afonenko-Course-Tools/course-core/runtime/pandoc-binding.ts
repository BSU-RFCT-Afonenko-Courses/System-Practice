import { basename, dirname, join, resolve } from "stdlib/path";

/** Узкий child binding штатной frozen native composition; не новый runtime registry. */
export type NativePandocBinding = Readonly<{
  executable: string;
  environment: Readonly<Record<string, string>>;
  cwd: string;
  diagnosticTool: string;
}>;
export type NativePandocHost = Readonly<{
  environment: Readonly<Record<string, string>>;
  cwd: string;
}>;

function launcherEnvironmentMatches(
  executable: string,
  host: NativePandocHost,
) {
  const env = host.environment,
    bin = dirname(executable),
    arch = Deno.build.arch;
  if (
    resolve(executable) !== executable || basename(executable) !== "quarto" ||
    env.QUARTO !== executable || env.QUARTO_BIN_PATH !== bin ||
    env.QUARTO_SHARE_PATH !== resolve(bin, "../share") ||
    env.QUARTO_ROOT !== resolve(bin, "../../..") ||
    env.QUARTO_DEBUG === "true" || env.QUARTO_FORCE_VERSION ||
    !env.QUARTO_DENO ||
    env.DENO_DOM_PLUGIN !== (env.QUARTO_DENO_DOM ||
        join(bin, "tools", arch, "deno_dom/libplugin.so")) ||
    env.DENO_TLS_CA_STORE !== "system,mozilla" ||
    env.DENO_NO_UPDATE_CHECK !== "1"
  ) {
    return undefined;
  }
  return true;
}
/** Вызывается один раз на operation. Любая неизвестная composition остаётся Quarto CLI. */
export async function selectNativePandoc(
  executable: string | undefined,
  version: string | undefined,
  host: NativePandocHost | undefined,
): Promise<NativePandocBinding | undefined> {
  if (
    !executable || !host || !version ||
    !["1.11.5", "1.12.1"].includes(version) ||
    Deno.build.os !== "linux" ||
    !["x86_64", "aarch64"].includes(Deno.build.arch)
  ) return undefined;
  if (!launcherEnvironmentMatches(executable, host)) return undefined;
  const env = host.environment,
    bin = dirname(executable),
    arch = Deno.build.arch;
  // Эти exported controls/locals launcher переписывает; их перенос не эмулируем.
  for (
    const key of [
      "QUARTO_ACTION",
      "QUARTO_TARGET",
      "QUARTO_DEV_MODE",
      "QUARTO_IMPORT_MAP_ARG",
      "QUARTO_TS_PROFILE",
      "QUARTO_CACHE_OPTIONS",
      "QUARTO_DENO_OPTIONS",
      "QUARTO_DENO_EXTRA_OPTIONS",
      "QUARTO_DENO_V8_OPTIONS",
      "SOURCE",
      "PREV_DIR",
      "SOURCE_NAME",
      "SCRIPT_PATH",
      "SCRIPT_BASENAME",
      "QUARTO_SRC_PATH",
      "DEV_PATH",
      "ARCH_DIR",
      "NIXARCH",
      "DENO_ARCH_DIR",
      "QUARTO_LOCK_ARG",
      "QUARTO_LOCK_OPTIONS",
      "BASH_ENV",
    ]
  ) {
    if (Object.hasOwn(env, key)) return undefined;
  }
  try {
    if (
      !(await Deno.stat(executable)).isFile ||
      !(await Deno.stat(join(bin, "quarto.js"))).isFile ||
      !(await Deno.stat(resolve(bin, "../share"))).isDirectory
    ) return undefined;
    try {
      await Deno.stat(resolve(bin, "../../../src/quarto.ts"));
      return undefined;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) return undefined;
    }
    let selected = env.QUARTO_PANDOC;
    if (selected) {
      if (!selected.startsWith("/") || resolve(selected) !== selected) {
        return undefined;
      }
      const info = await Deno.stat(selected);
      if (!info.isFile) {
        if (!info.isDirectory) return undefined;
        selected = join(selected, "pandoc");
        if (!(await Deno.stat(selected)).isFile) return undefined;
      }
    } else {
      selected = join(bin, "tools", arch, "pandoc");
      if (!(await Deno.stat(selected)).isFile) return undefined;
    }
    // SHLVL и '_' — bookkeeping shell; в semantic Pandoc env contract не входят.
    return Object.freeze({
      executable: selected,
      environment: env,
      cwd: host.cwd,
      diagnosticTool: executable,
    });
  } catch {
    return undefined;
  }
}

import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import type { NativePandocBinding } from "./pandoc-binding.ts";
type ChildScope = {
  beforeChild: () => Promise<void>;
  lives: { active: boolean }[];
  pandocBinding?: (() => Promise<NativePandocBinding | undefined>) | undefined;
};
const current = new AsyncLocalStorage<ChildScope>();
function scope() {
  const value = current.getStore();
  if (value?.lives.some((life) => !life.active)) {
    fail("OPERATION_EXPIRED", "Native child callback/batch scope истёк");
  }
  return value;
}
/** Tool context carries no assignment runtime, capture token or authority. */
export async function withNativeChildScope<T>(input: {
  beforeChild: () => Promise<void>;
  life: { active: boolean };
  pandocBinding?: (() => Promise<NativePandocBinding | undefined>) | undefined;
}, use: () => Promise<T>) {
  const parent = scope(), life = { active: true };
  try {
    return await current.run({
      beforeChild: input.beforeChild,
      lives: [...parent?.lives ?? [], input.life, life],
      pandocBinding: input.pandocBinding ?? parent?.pandocBinding,
    }, use);
  } finally {
    life.active = false;
  }
}
export async function nativeChildBefore() {
  const value = scope();
  if (!value) return false;
  await value.beforeChild();
  scope();
  return true;
}
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function qualifiedPandocArgs(args: readonly string[], root: string) {
  return args[0] === "pandoc" && (
    equal(args, [
      "pandoc",
      "--from",
      "markdown",
      "--to",
      "json",
      "--wrap=none",
    ]) ||
    equal(args, ["pandoc", "--from", "json", "--to", "gfm", "--wrap=none"]) ||
    args.length === 5 &&
      equal(args.slice(0, 4), [
        "pandoc",
        "--from=json",
        "--to=json",
        "--citeproc",
      ]) &&
      typeof args[4] === "string" && args[4].startsWith("--resource-path=") &&
      (args[4] === "--resource-path=" + root ||
        args[4].slice(16).startsWith(root + "/")) &&
      resolve(args[4].slice(16)) === args[4].slice(16)
  );
}

/** Ordinary conversion can bypass only the equivalent qualified launcher. */
export async function ordinaryPandocChild(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}) {
  const value = scope();
  const binding = await value?.pandocBinding?.();
  scope();
  if (
    !binding || !qualifiedPandocArgs(input.args, input.cwd) ||
    input.executable !== binding.diagnosticTool || input.cwd !== binding.cwd
  ) return undefined;
  const expected = { ...binding.environment };
  // This fixed override is already supplied by the materializer to Quarto CLI.
  if (input.env.QUARTO_RUN_NO_NETWORK === "true") {
    expected.QUARTO_RUN_NO_NETWORK = "true";
  }
  const environment = { ...Deno.env.toObject(), ...input.env };
  if (
    Object.keys(environment).length !==
      Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => environment[key] !== value)
  ) return undefined;
  // Bash launcher corrects PWD when an explicit child cwd differs.
  const childEnvironment: Record<string, string> = {
    ...expected,
    PWD: input.cwd,
  };
  return {
    executable: binding.executable,
    options: {
      args: [...input.args.slice(1)],
      cwd: input.cwd,
      env: childEnvironment,
      clearEnv: true as const,
    },
  };
}

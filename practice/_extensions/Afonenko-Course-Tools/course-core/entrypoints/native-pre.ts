import { beginNativePreHook } from "../runtime/operation.ts";
import { runCli } from "./diagnostics.ts";
await runCli(() => beginNativePreHook(Deno.env.get("QUARTO_PROJECT_DIR") || Deno.cwd()));

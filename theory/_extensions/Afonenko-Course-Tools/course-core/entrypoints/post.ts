import { finishNativePostHook } from "../runtime/operation.ts";
import { runCli } from "./diagnostics.ts";
await runCli(() => finishNativePostHook(Deno.env.get("QUARTO_PROJECT_DIR") || Deno.cwd()));

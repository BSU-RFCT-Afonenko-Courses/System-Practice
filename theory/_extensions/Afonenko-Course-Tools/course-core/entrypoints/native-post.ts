import { finishNativeOperation } from "../runtime/operation.ts";
await finishNativeOperation(Deno.env.get("QUARTO_PROJECT_DIR") || Deno.cwd());

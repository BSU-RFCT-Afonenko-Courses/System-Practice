import { beginNativeOperation } from "../runtime/operation.ts";
await beginNativeOperation(Deno.env.get("QUARTO_PROJECT_DIR") || Deno.cwd());

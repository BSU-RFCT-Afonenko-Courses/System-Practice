import { diagnostic } from "../diagnostics.ts";
import { isRecord } from "./import-config.ts";

export interface PostInspection {
  config: Record<string, unknown>;
  namespace: string;
}

export function postConfiguration(inspection: unknown, root: string): PostInspection {
  const config = isRecord(inspection) && isRecord(inspection.config) ? inspection.config : undefined;
  const reference = config?.["reference-catalog"];
  const namespace = isRecord(reference) ? reference.namespace : undefined;
  if (!config || typeof namespace !== "string" || !namespace) throw diagnostic("QRC.CONFIG_INVALID", "самостоятельному проекту требуется reference-catalog.namespace", { source: root, field: "reference-catalog.namespace" });
  return { config, namespace };
}

export function postQuartoVersion(inspection: unknown, root: string): string {
  const quarto = isRecord(inspection) && isRecord(inspection.quarto) ? inspection.quarto : undefined;
  const version = quarto?.version;
  if (typeof version !== "string" || !version.trim()) throw diagnostic("QRC.CONFIG_INVALID", "Quarto inspect не вернул версию Quarto", { source: root, field: "quarto.version" });
  return version.trim();
}

export function postOutputDirectory(config: Record<string, unknown>, override: string | undefined, root: string): string {
  const project = isRecord(config.project) ? config.project : undefined;
  const output = override ?? project?.["output-dir"] ?? "_site";
  if (typeof output !== "string") throw diagnostic("QRC.CONFIG_INVALID", "project.output-dir должен быть строкой", { source: root, field: "project.output-dir" });
  return output;
}

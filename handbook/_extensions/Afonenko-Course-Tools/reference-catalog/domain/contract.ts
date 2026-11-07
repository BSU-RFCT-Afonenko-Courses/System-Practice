/** Публичные имена и конечные множества конфигурации QRC. */
import { referenceStyles } from "./generated/reference-styles.ts";
export { referenceStyles };
export function isReferenceStyle(value: unknown): value is typeof referenceStyles[number] {
  return referenceStyles.some(style => style === value);
}
export const configKeys = ["namespace", "imports", "exports", "publication"] as const;
export const importKeys = ["source", "namespace", "base-url", "title", "style"] as const;
export const namespacePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

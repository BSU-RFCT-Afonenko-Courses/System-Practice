import type { BodyPackage, BodyQuestion } from "./package-contracts.ts";
export type { BodyPackage, BodyQuestion, BodyResource } from "./package-contracts.ts";
export type Node = { t: string; c?: unknown };
export type PublicBodyPackage = Omit<BodyPackage, "questions"> & {
  questions: Omit<BodyQuestion, "closedKey" | "solution" | "gradingNotes">[];
};

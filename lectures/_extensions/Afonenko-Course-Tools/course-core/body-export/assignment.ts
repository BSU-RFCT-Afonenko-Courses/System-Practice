import { citationFileInputs } from "./citation-inputs.ts";
import type { CitationFileKey } from "./citation-inputs.ts";
import { dirname, resolve } from "stdlib/path";
import { fail } from "../contracts/project.ts";
import { visibleTitle } from "../document/title.ts";
import { NativeAssignmentConditionSchema } from "../artifacts/contracts.ts";
import type { NativeAssignmentCondition } from "../artifacts/contracts.ts";
import type { NativePublicDocument } from "../runtime/contracts.ts";
import type { NativeReleaseFacts } from "../release/contracts.ts";
import {
  assertBodyPackage,
  preparePublicIntroduction,
  preparePublicQuestion,
  publicCondition,
  publicResourceUses,
} from "./producer.ts";
import type { BodyReferenceContext } from "./links.ts";
import type { BodyPackage, Node, PublicBodyPackage } from "./model.ts";
import { isLink, isRecord, nodeAttributes } from "../document/native-ast.ts";
export type AssignmentBodyCache = {
  questions: Map<string, { condition: Node[]; publicAnswer: Node[] }>;
  introductions: Map<string, Node[]>;
};
type Resource = { bytes: Uint8Array; identity: string };
/** Assembly of already finalized native fragments; no legacy model or capture. */
export async function buildAssignmentBody(input: {
  root: string;
  owner: string;
  cache?: AssignmentBodyCache | undefined;
  work: {
    source: string;
    composition: NonNullable<NativeReleaseFacts["assessment"]>;
  };
  documents: readonly NativePublicDocument[];
  references?: BodyReferenceContext | undefined;
  assertPublicResource: (absolute: string) => void;
  assertCitationResource: (
    source: string,
    key: CitationFileKey,
    path: string,
  ) => Promise<void>;
  readResource: (
    source: string,
    target: string,
    document: string,
  ) => Promise<Resource>;
}) {
  const { root, owner, work } = input, composition = work.composition;
  const workDoc = input.documents.find((d) => d.context.input === work.source);
  if (
    !workDoc?.assignment ||
    !Object.hasOwn(workDoc.assignment.introductions, composition.id)
  ) {
    fail(
      "BODY.ASSESSMENT_OCCURRENCE_MISMATCH",
      "Нет exact native introduction",
    );
  }
  const documentMeta = async (doc: NativePublicDocument) => {
    const meta = doc.assignment!.citationMetadata;
    for (const { key, path } of citationFileInputs(meta)) {
      await input.assertCitationResource(doc.context.input, key, path);
    }
    return { "pandoc-api-version": doc.pandocApiVersion, meta };
  };
  const introKey = JSON.stringify([
    workDoc.context,
    workDoc.pandocApiVersion,
    composition.id,
  ]);
  let overview = input.cache?.introductions.get(introKey);
  if (!overview) {
    overview = await preparePublicIntroduction({
      blocks: workDoc.assignment.introductions[composition.id]!,
      document: await documentMeta(workDoc),
      root: root,
      context: { source: work.source, id: composition.id },
      references: input.references,
      effectiveBase: dirname(resolve(root, work.source)),
    });
    input.cache?.introductions.set(introKey, structuredClone(overview));
  }
  overview = structuredClone(overview);
  const conditions: Record<string, NativeAssignmentCondition> = {};
  const pkg: BodyPackage = {
    schema: "course-body-package-v2",
    owner,
    release: "native",
    apiVersion: [...workDoc.pandocApiVersion],
    questions: [],
    works: [],
    resources: [],
  };
  for (const id of composition.slots.flatMap((slot) => slot.candidates)) {
    const docs = input.documents.filter((d) =>
      Object.hasOwn(d.definitions, id)
    );
    if (docs.length !== 1) {
      fail(
        "BODY.ASSIGNMENT_MEMBERSHIP",
        "Кандидат не принадлежит одному native bank " + id,
      );
    }
    const doc = docs[0]!,
      rows = doc.occurrences.filter((r) =>
        r.kind === "exercise" && r.exerciseId === id
      ),
      answer = doc.assignment?.answers[id];
    if (rows.length !== 1 || !answer) {
      fail("BODY.ANSWER_OCCURRENCE_MISMATCH", "Нет exact late candidate " + id);
    }
    const source = doc.context.input,
      declaration = doc.definitions[id]!,
      row = rows[0]!;
    if (
      JSON.stringify(doc.pandocApiVersion) !== JSON.stringify(pkg.apiVersion)
    ) {
      fail("BODY.CAPABILITY_UNSUPPORTED", "Разные actual Pandoc API versions");
    }
    const questionKey = JSON.stringify([doc.context, doc.pandocApiVersion, id]);
    let prepared = input.cache?.questions.get(questionKey);
    if (!prepared) {
      prepared = await preparePublicQuestion({
        condition: publicCondition(row.body, !!row.title?.length),
        publicAnswer: answer.publicAnswer,
        document: await documentMeta(doc),
        root: root,
        context: { source, id },
        references: input.references,
        effectiveBase: dirname(resolve(root, source)),
      });
      input.cache?.questions.set(questionKey, structuredClone(prepared));
    }
    prepared = structuredClone(prepared);
    const links = new Set<string>(), resources = new Set<string>();
    const body = [...prepared.condition, ...prepared.publicAnswer];
    function uses(v: unknown) {
      if (Array.isArray(v)) {
        v.forEach(uses);
        return;
      }
      if (!isRecord(v)) {
        return;
      }
      nodeAttributes(v);
      if (isLink(v)) {
        (v.t === "Link" ? links : resources).add(v.c[2][0]);
      }
      Object.values(v).forEach(uses);
    }
    uses(body);
    conditions[id] = NativeAssignmentConditionSchema.parse({
      kind: "assignment",
      audience: "student",
      assessment: { source: work.source, id: composition.id },
      context: doc.context,
      exerciseId: id,
      occurrence: row.key,
      anchor: row.anchor,
      ...(declaration.project ? { project: declaration.project } : {}),
      pandocApiVersion: doc.pandocApiVersion,
      body,
      links: [...links].sort(),
      resources: [...resources].sort(),
      responseSlots: answer.responseSlots,
    });
    const title = visibleTitle(row.title).trim();
    pkg.questions.push({
      owner,
      id,
      key: owner + "/" + id,
      source,
      ...(title ? { title } : {}),
      visibility: "public",
      statementVisibility: declaration["statement-visibility"],
      difficulty: declaration.difficulty,
      ...(declaration.time !== undefined ? { time: declaration.time } : {}),
      ...(declaration["course-role"]
        ? { purpose: declaration["course-role"] }
        : {}),
      hasPublicSolution: doc.hasPublicSolution[id] === true,
      answerType: answer.type,
      condition: structuredClone(prepared.condition),
      publicAnswer: structuredClone(prepared.publicAnswer),
      closedKey: null,
      solution: [],
      gradingNotes: [],
    });
  }
  pkg.works.push({
    owner,
    id: composition.id,
    key: owner + "/" + composition.id,
    source: work.source,
    kind: composition.kind,
    title: composition.title,
    introduction: structuredClone(overview),
    slots: composition.slots.map((slot) => ({
      ...slot,
      id: owner + "/" + composition.id + "/" + slot.id,
      candidates: slot.candidates.map((id) => owner + "/" + id),
    })),
    ...(composition.theoryTime !== undefined
      ? { theoryTime: composition.theoryTime }
      : {}),
    ...(composition.relatedExercise
      ? { relatedExercise: composition.relatedExercise }
      : {}),
  });
  const uses = new Map<string, string>();
  function collect(blocks: unknown[], source: string) {
    for (
      const path of publicResourceUses(
        blocks,
        root,
        source,
        dirname(resolve(root, source)),
      )
    ) {
      const absolute = resolve(root, path);
      if (!absolute.startsWith(root + "/")) {
        fail("RESOURCE_PATH", "Body resource вне owner");
      }
      input.assertPublicResource(absolute);
      if (!uses.has(path)) uses.set(path, source);
    }
  }
  for (const question of pkg.questions) {
    collect(question.condition, question.source);
    collect(question.publicAnswer, question.source);
  }
  collect(pkg.works[0]!.introduction!, work.source);
  const targets = new Map<string, string>(),
    physical = new Map<string, string>();
  for (const [path, source] of uses) {
    const resource = await input.readResource(path, path, source);
    let target = physical.get(resource.identity);
    if (!target) {
      target = path;
      physical.set(resource.identity, target);
      let binary = "";
      for (const byte of resource.bytes) binary += String.fromCharCode(byte);
      pkg.resources.push({
        owner,
        source,
        effectiveBase: dirname(resolve(root, source)),
        target,
        data: btoa(binary),
        visibility: "public",
      });
    }
    targets.set(resolve(root, path), target);
  }
  for (const question of pkg.questions) {
    publicResourceUses(
      question.condition,
      root,
      question.source,
      dirname(resolve(root, question.source)),
      targets,
    );
    publicResourceUses(
      question.publicAnswer,
      root,
      question.source,
      dirname(resolve(root, question.source)),
      targets,
    );
  }
  publicResourceUses(
    pkg.works[0]!.introduction!,
    root,
    work.source,
    dirname(resolve(root, work.source)),
    targets,
  );
  await assertBodyPackage(pkg, root);
  const publicPackage: PublicBodyPackage = {
    ...pkg,
    questions: pkg.questions.map((
      { closedKey, solution, gradingNotes, ...question },
    ) => question),
  };
  return { publicPackage, conditions };
}

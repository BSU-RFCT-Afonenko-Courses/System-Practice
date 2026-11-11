/** Публичная композиция меню готовых native HTML и Reveal. */
export { composeNavigation } from "./composition.ts";
export type { NavigationComposition, NavigationMember } from "./composition.ts";

/** Указатель текущих упражнений с нормализованными Core подписями. */
export { renderExerciseIndex } from "./exercise-index.ts";
export type {
  ExerciseIndexDocument,
  ExerciseIndexRequest,
  ExerciseIndexTopic,
} from "./exercise-index.ts";

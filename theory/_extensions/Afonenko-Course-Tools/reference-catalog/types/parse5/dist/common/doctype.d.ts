// Создано tools/generate-parse5-types.ts из vendor/parse5 7.3.0. Только относительные .js заменены на .d.ts; см. LICENSE.
import { DOCUMENT_MODE } from './html.d.ts';
import type { DoctypeToken } from './token.d.ts';
export declare function isConforming(token: DoctypeToken): boolean;
export declare function getDocumentMode(token: DoctypeToken): DOCUMENT_MODE;

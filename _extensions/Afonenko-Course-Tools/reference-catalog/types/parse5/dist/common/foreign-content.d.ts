// Создано tools/generate-parse5-types.ts из vendor/parse5 7.3.0. Только относительные .js заменены на .d.ts; см. LICENSE.
import { TAG_ID as $, NS } from './html.d.ts';
import type { TagToken, Attribute } from './token.d.ts';
export declare const SVG_TAG_NAMES_ADJUSTMENT_MAP: Map<string, string>;
export declare function causesExit(startTagToken: TagToken): boolean;
export declare function adjustTokenMathMLAttrs(token: TagToken): void;
export declare function adjustTokenSVGAttrs(token: TagToken): void;
export declare function adjustTokenXMLAttrs(token: TagToken): void;
export declare function adjustTokenSVGTagName(token: TagToken): void;
export declare function isIntegrationPoint(tn: $, ns: NS, attrs: Attribute[], foreignNS?: NS): boolean;

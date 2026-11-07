// Создано tools/generate-parse5-types.ts из vendor/entities 6.0.1. Только относительные .js заменены на .d.ts; см. LICENSE.
type EncodeTrieNode = string | {
    v?: string;
    n: number | Map<number, EncodeTrieNode>;
    o?: string;
};
export declare const htmlTrie: Map<number, EncodeTrieNode>;
export {};
//# sourceMappingURL=encode-html.d.ts.map
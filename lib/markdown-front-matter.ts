import { isMap, isScalar, isSeq, parseDocument, stringify } from "yaml";

const maxMetadataBytes = 32 * 1024;
const maxNodes = 4096;
const maxDepth = 20;
const encoder = new TextEncoder();
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

export class MarkdownFrontMatterError extends Error {
  readonly code: "missing_front_matter" | "invalid_front_matter" | "document_too_large";

  constructor(code: MarkdownFrontMatterError["code"]) {
    super(code);
    this.code = code;
  }
}

function invalid(): never {
  throw new MarkdownFrontMatterError("invalid_front_matter");
}

function parseMetadata(source: string, timestamps: boolean): unknown {
  if (!source.trim()) throw new MarkdownFrontMatterError("missing_front_matter");
  if (encoder.encode(source).byteLength > maxMetadataBytes) invalid();

  // A fixed schema only resolves data. Inspect the AST before converting it to JS.
  const document = parseDocument(source, { version: "1.2", schema: "core", customTags: timestamps ? ["timestamp"] : [], strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length || document.directives?.yaml.explicit ||
      document.directives?.docEnd || !isMap(document.contents)) invalid();

  let count = 0;
  function validate(node: unknown, depth: number) {
    if (++count > maxNodes || depth > maxDepth) invalid();
    if (isScalar(node) || isMap(node) || isSeq(node)) {
      if (node.tag || node.anchor) invalid();
    } else if (node !== null) invalid(); // Includes aliases.

    if (isMap(node)) {
      for (const { key, value } of node.items) {
        if (!isScalar(key) || typeof key.value !== "string" || forbiddenKeys.has(key.value)) invalid();
        validate(key, depth + 1);
        validate(value, depth + 1);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) validate(item, depth + 1);
    }
  }
  validate(document.contents, 0);
  return document.toJS({ maxAliasCount: 0 });
}

export function parseMarkdownFrontMatter(markdown: string, maxDocumentBytes: number, { timestamps = false } = {}) {
  if (markdown.length > maxDocumentBytes || encoder.encode(markdown).byteLength > maxDocumentBytes) throw new MarkdownFrontMatterError("document_too_large");
  if (!/^\uFEFF?---/.test(markdown)) throw new MarkdownFrontMatterError("missing_front_matter");
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(markdown);
  if (!opening) invalid();
  // Bound the search even when a large Markdown body has no closing delimiter.
  const remaining = markdown.slice(opening[0].length);
  const closing = /(?:^|(?<=\n))---[ \t]*(?:\r?\n|$)/;
  const boundary = closing.exec(remaining.slice(0, maxMetadataBytes + 4));
  if (!boundary || boundary.index > maxMetadataBytes ||
      (!boundary[0].endsWith("\n") && boundary.index + boundary[0].length !== remaining.length)) invalid();
  return { data: parseMetadata(remaining.slice(0, boundary.index), timestamps), body: remaining.slice(boundary.index + boundary[0].length) };
}

/** Callers supply schema-validated metadata. The body is copied as opaque Markdown. */
export function serializeMarkdownFrontMatter(metadata: Record<string, unknown>, body: string, maxDocumentBytes: number, { timestamps = false } = {}) {
  const source = stringify(metadata, { version: "1.2", schema: "core", customTags: timestamps ? ["timestamp"] : [], aliasDuplicateObjects: false, lineWidth: 0, singleQuote: true });
  parseMetadata(source, timestamps);
  const markdown = `---\n${source}---\n${body}`;
  if (markdown.length > maxDocumentBytes || encoder.encode(markdown).byteLength > maxDocumentBytes) throw new MarkdownFrontMatterError("document_too_large");
  return markdown;
}

/**
 * HTML -> scannable text.
 *
 * DELIBERATELY NOT a readability-style "clean article" extractor. Hidden text
 * is a primary prompt-injection carrier, so this KEEPS what a reader-mode
 * extractor throws away: HTML comments, and alt/title/aria-label attribute
 * text. Removing them would hide attacks from the scanner (SPEC decision D-13).
 * Optionally the raw markup is scanned too.
 */

const BLOCK_TAGS = /<\/(p|div|section|article|li|tr|h[1-6]|br|hr|blockquote|pre|td|th)>/gi;

export function extractText(html, { includeRawHtml = false } = {}) {
  const raw = String(html ?? "");
  const parts = [];

  // Preserve HTML comments — classic hidden-instruction channel.
  for (const match of raw.matchAll(/<!--([\s\S]*?)-->/g)) {
    const comment = match[1].trim();
    if (comment) parts.push(comment);
  }

  // Preserve attribute text that renders or is announced to assistive tech.
  for (const match of raw.matchAll(/\b(?:alt|title|aria-label)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const value = (match[2] ?? match[3] ?? "").trim();
    if (value) parts.push(value);
  }

  // Strip script/style entirely (their content is not model-facing text, and
  // scanning JS/CSS produces noise), then reduce tags to whitespace.
  let body = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/g, " ");

  body = decodeEntities(body).replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  parts.push(body);

  if (includeRawHtml) parts.push(raw);
  return parts.filter(Boolean).join("\n");
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const codePoint = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/** Best-effort content-type dispatch: HTML gets extracted, everything else passes through. */
export function toScannableText(body, contentType, options = {}) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("html") || /<html[\s>]|<!doctype html/i.test(body.slice(0, 512))) {
    return extractText(body, options);
  }
  return String(body ?? "");
}

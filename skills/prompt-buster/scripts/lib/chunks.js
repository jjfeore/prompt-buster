/**
 * Character-bounded chunking with proportional overlap.
 * Port of Abeeo's overlapping_text_chunks — semantics must stay identical
 * because the LightGBM golden vectors were generated against them.
 */
export function overlappingTextChunks(text, { maxChars, overlapRatio = 0.1 }) {
  const value = String(text ?? "");
  const bound = Math.max(1, Math.trunc(maxChars || 1));
  if (value.length <= bound) {
    return [{ text: value, start: 0, end: value.length, index: 0, count: 1 }];
  }

  let overlap = Math.trunc(bound * overlapRatio);
  overlap = Math.min(Math.max(overlap, 0), bound - 1);
  const step = bound - overlap;

  const ranges = [];
  let start = 0;
  while (start < value.length) {
    const end = Math.min(start + bound, value.length);
    ranges.push([start, end]);
    if (end >= value.length) break;
    start += step;
  }

  const count = ranges.length;
  return ranges.map(([s, e], index) => ({ text: value.slice(s, e), start: s, end: e, index, count }));
}

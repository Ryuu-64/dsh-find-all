// Marks are only rendered by the detached text projector. Comparing the full
// projection before and after strips out Markdown changes caused by the marks.
const BEFORE = '\uE000\uE001';
const AFTER = '\uE002\uE003';

export function projectAnchor(project, source, { anchor, snippet, range }) {
  const { raw } = source;
  const { start, end, excerptStart, excerptEnd } = anchor;
  if (excerptEnd > raw.length || raw.includes(BEFORE) || raw.includes(AFTER)) return null;
  const expected = (excerptStart > 0 ? '…' : '') + raw.slice(excerptStart, excerptEnd) + (excerptEnd < raw.length ? '…' : '');
  const text = raw.slice(start, end);
  if (expected !== snippet || text !== snippet.slice(range.start, range.end)) return null;

  const projected = { ...source, ...project(source) };
  const marked = project({ ...source, raw: raw.slice(0, start) + BEFORE + text + AFTER + raw.slice(end) });
  if (!Array.isArray(marked.blocks) || marked.blocks.length !== projected.blocks?.length) return null;

  let hit = null;
  for (const [blockIndex, block] of marked.blocks.entries()) {
    const value = block.text;
    if (value.replaceAll(BEFORE, '').replaceAll(AFTER, '') !== projected.blocks[blockIndex].text) return null;
    const offset = value.indexOf(BEFORE);
    if (offset === -1 && !value.includes(AFTER)) continue;
    if (hit || offset === -1 || value.indexOf(BEFORE, offset + BEFORE.length) !== -1 ||
        value.indexOf(AFTER) !== offset + BEFORE.length + text.length ||
        value.indexOf(AFTER, offset + BEFORE.length + text.length + AFTER.length) !== -1 ||
        value.slice(offset + BEFORE.length, offset + BEFORE.length + text.length) !== text ||
        projected.blocks[blockIndex].imageDescription) return null;
    hit = { source: projected, blockIndex, start: offset, end: offset + text.length, text };
  }
  return hit;
}

// Browser-side assertions for the plain-text synthetic user-message fixture.
// The saved object contains immutable offsets/text plus the original Text node,
// not a live Range whose offsets could move during a history prepend.
export function captureInitialSelection({ label, query }) {
  const hits = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
  const current = [...(CSS.highlights.get('dsh-find-all-cur') || [])];
  if (current.length !== 1 || !hits.length) throw Error('one initial current highlight is required');
  const range = current[0], first = hits[0];
  if (range.startContainer !== first.startContainer || range.endContainer !== first.endContainer ||
      range.startOffset !== first.startOffset || range.endOffset !== first.endOffset) throw Error('initial selection must be the first rendered hit');
  if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) throw Error('fixture hit must occupy one Text node');
  const flow = document.querySelector('[data-chat-flow]');
  if (!flow || !flow.contains(range.startContainer)) throw Error('initial current hit must belong to the active flow');
  const text = range.startContainer.data;
  const match = text.match(new RegExp(`^FIND_ALL_${label}_USER_(\\d{3}) synthetic user$`));
  if (!match || range.toString() !== query || range.startOffset !== 0 || range.endOffset !== query.length) throw Error('initial fixture identity and text offsets must be exact');
  return { node: range.startContainer, flow, text, start: range.startOffset, end: range.endOffset,
    marker: Number(match[1]), query, label, initialTotal: hits.length };
}

export function assertRetainedSelection(saved) {
  const hits = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
  const current = [...(CSS.highlights.get('dsh-find-all-cur') || [])];
  if (current.length !== 1) throw Error('one retained current highlight is required');
  const range = current[0];
  const expectedHit = hits[saved.marker - 1];
  if (hits.length !== 80 || !expectedHit || saved.flow !== document.querySelector('[data-chat-flow]') ||
      !saved.flow.contains(range.startContainer) || range.startContainer !== expectedHit.startContainer ||
      range.endContainer !== expectedHit.endContainer || range.startOffset !== expectedHit.startOffset ||
      range.endOffset !== expectedHit.endOffset) throw Error('retained current must be the exact expected hit inside the active flow');
  if (!saved.node.isConnected || range.startContainer !== saved.node || range.endContainer !== saved.node ||
      saved.node.data !== saved.text || range.startOffset !== saved.start || range.endOffset !== saved.end ||
      range.toString() !== saved.query) throw Error('history prepend must retain the exact original Text identity and offsets');
  return saved.marker;
}

export function assertCompleteFixtureRanges({ label, query }) {
  const ranges = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
  const flow = document.querySelector('[data-chat-flow]');
  if (ranges.length !== 80 || !flow) throw Error('all 80 fixture matches are required');
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    const expected = `FIND_ALL_${label}_USER_${String(index + 1).padStart(3, '0')} synthetic user`;
    if (!flow.contains(range.startContainer) || range.startContainer !== range.endContainer ||
        range.startContainer.data !== expected || range.toString() !== query ||
        range.startOffset !== 0 || range.endOffset !== query.length) throw Error(`fixture match ${index + 1} must retain its exact identity, order, scope and offsets`);
  }
  return ranges.length;
}

export function assertSelectedFixtureToken({ label, query, marker, total }) {
  const hits = [...(CSS.highlights.get('dsh-find-all-hit') || [])];
  const current = [...(CSS.highlights.get('dsh-find-all-cur') || [])];
  const expected = `FIND_ALL_${label}_USER_${String(marker).padStart(3, '0')} synthetic user`;
  if (hits.length !== total || current.length !== 1) throw Error('exact match count and one current highlight are required');
  const range = current[0];
  const expectedHit = hits[total === 80 ? marker - 1 : 0];
  const flow = document.querySelector('[data-chat-flow]');
  if (![1, 80].includes(total) || !expectedHit || !flow || !flow.contains(range.startContainer) ||
      range.startContainer !== expectedHit.startContainer || range.endContainer !== expectedHit.endContainer ||
      range.startOffset !== expectedHit.startOffset || range.endOffset !== expectedHit.endOffset) throw Error('current must be the exact expected hit inside the active flow');
  if (range.startContainer !== range.endContainer || range.startContainer.data !== expected ||
      range.toString() !== query || range.startOffset !== 0 || range.endOffset !== query.length) throw Error('navigation/first match must select the exact fixture token and offsets');
  return marker;
}

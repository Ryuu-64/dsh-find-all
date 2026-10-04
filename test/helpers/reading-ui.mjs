import assert from 'node:assert/strict';
import {setup, snapshot} from './search-ui.mjs';

// Geometry here is a deterministic state-machine fixture, not host acceptance.
export async function reader() {
  const h = setup(), nodes = new Map();
  const store = {get: key => nodes.get(key), values: () => [...nodes.values()]};
  const v = await h.mount('a', true, {useChat: select => select({nodes: store})});
  const scroll = v.flow.closest('[data-conversation-scroll]');
  let top = 440;
  Object.defineProperties(scroll, {
    scrollTop: {get: () => top, set: value => {top = Math.max(0, Math.min(1800, value));}},
    clientHeight: {get: () => 200}, scrollHeight: {get: () => 2000},
  });
  const rect = (y, height = 20) => ({top: y, bottom: y + height, left: 0, right: 400, width: 400, height});
  scroll.getBoundingClientRect = () => rect(0, 200);
  scroll.scrollTo = ({top: value}) => {scroll.scrollTop = value;};
  function setRows() {
    v.flow.innerHTML = '<div data-chat-node-key="origin" data-chat-anchor-key="origin"><p data-y="400">first paragraph</p><p data-y="460">original reading paragraph</p><p data-y="520">third paragraph</p></div><div data-chat-node-key="hit" data-chat-anchor-key="hit"><p data-y="1400">needle other</p><p data-y="1500">needle other</p></div>';
  }
  setRows();
  nodes.set('origin', {key: 'origin', anchorSeq: 10, visibility: 'visible'});
  nodes.set('hit', {key: 'hit', anchorSeq: 20, visibility: 'visible'});
  const nativeRects = h.w.HTMLElement.prototype.getClientRects;
  h.w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.dataset.y) return rect(Number(this.dataset.y) - top);
    const p = this.querySelector?.('[data-y]');
    return p ? rect(Number(p.dataset.y) - top, 140) : rect(0, 20);
  };
  h.w.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected ? [this.getBoundingClientRect()] : nativeRects.call(this);
  };
  h.w.HTMLElement.prototype.scrollIntoView = function () {
    h.scrolls.push(this);
    const p = this.closest('[data-y]');
    if (p) scroll.scrollTop = Number(p.dataset.y) - 80;
  };
  h.w.Range.prototype.getClientRects = function () {
    const p = this.startContainer.parentElement?.closest('[data-y]');
    return p?.isConnected ? [rect(Number(p.dataset.y) - top)] : [];
  };
  h.w.Range.prototype.getBoundingClientRect = function () {return this.getClientRects()[0] || rect(0, 0);};
  h.faces.set('a', {getSnapshot: () => snapshot({hasMore: false}), loadOlder() {assert.fail('terminal history');}});
  const button = () => h.w.document.querySelector('[data-find-all-return]');
  function open() {h.open(v.anchor); h.w.document.querySelector('.scope').click();}
  return {...h, v, nodes, scroll, button, openReader: open, setRows};
}


'use strict';

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * What the Media tab shows: the images, files and GIFs on messages that are still on the board, newest first.
 *
 * messages     all live messages, oldest first (as MessageStore.sorted)
 * isRemoved    true for messages that are deleted or hidden, whose media must not show
 * hasFile      whether this computer holds an attached file (by fingerprint)
 * hasGif       likewise for a GIF
 * retentionDays  attached files older than this many days are archived (so they're listed as such)
 * filter       'all', 'images' (pictures and GIFs) or 'files'
 * search       matches a file name or the sender's name
 */
function listMedia(messages, { isRemoved = () => false, hasFile = () => true, hasGif = () => true, retentionDays = 7, filter = 'all', search = '', now = Date.now(), limit = 300 } = {}) {
  const cutoff = dayOf(now - retentionDays * 86400000);
  const needle = search.trim().toLowerCase();
  const all = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.gif && !m.attachments) continue;
    if (isRemoved(m)) continue;
    const base = { messageId: m.id, from: m.from, author: m.author, to: m.to, createdAt: m.createdAt };
    if (m.gif) all.push({ ...base, key: `${m.id}:${m.gif.hash}`, kind: 'gif', name: 'GIF', hash: m.gif.hash, size: m.gif.size, w: m.gif.w, h: m.gif.h, present: hasGif(m.gif.hash), archived: false });
    for (const a of m.attachments || []) {
      all.push({
        ...base,
        key: `${m.id}:${a.hash}`,
        kind: a.kind,
        name: a.name,
        hash: a.hash,
        size: a.size,
        w: a.w,
        h: a.h,
        present: hasFile(a.hash),
        archived: dayOf(m.createdAt) < cutoff,
      });
    }
  }
  const matching = needle ? all.filter((x) => x.name.toLowerCase().includes(needle) || (x.author || '').toLowerCase().includes(needle)) : all;
  const isImage = (x) => x.kind === 'image' || x.kind === 'gif';
  const counts = { all: matching.length, images: matching.filter(isImage).length, files: matching.filter((x) => !isImage(x)).length };
  const shown = filter === 'images' ? matching.filter(isImage) : filter === 'files' ? matching.filter((x) => !isImage(x)) : matching;
  return { items: shown.slice(0, limit), counts, more: shown.length > limit };
}

module.exports = { listMedia };

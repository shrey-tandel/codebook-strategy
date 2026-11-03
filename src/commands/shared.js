'use strict';

const fs = require('fs');
const path = require('path');

const { exists } = require('../utils/file-writer');

// List real chapter markdown files in book/chapters/, ignoring dotfiles.
function listChapters(bookDir) {
  const dir = path.join(bookDir, 'chapters');
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .sort();
}

// Extract chapter names from the INDEX.md table.
//
// The table has the form:
//   | Chapter | Status | Last Updated | One-liner |
//   |---------|--------|-------------|-----------|
//   | auth    | active | 2026-01-01  | ...       |
//
// The first column holds the chapter name. HTML-comment placeholder rows
// (the template's example row) are ignored.
function parseIndexChapters(content) {
  const names = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;

    const first = cells[0];
    if (!first) continue;
    // Skip header and separator rows.
    if (/^chapter$/i.test(first)) continue;
    if (/^:?-{3,}:?$/.test(first)) continue;
    // Skip placeholder/comment rows from the template.
    if (first.startsWith('<!--')) continue;

    names.push(first);
  }
  return names;
}

// Extract topic references from CONNECTIONS.md lines of the form:
//   source/topic -> target/topic : reason
//   source/topic <-> target/topic : reason
// (using the ASCII or unicode arrows). Lines inside HTML comments are ignored.
//
// Returns [{ chapter, topic, raw }] — one entry per side of each connection.
function parseConnectionTopics(content) {
  const topics = [];
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('#')) continue;
    if (!/(↔|→|<->|->)/.test(trimmed)) continue;

    // Drop the reason after the first colon.
    const beforeReason = trimmed.split(':')[0];
    const sides = beforeReason.split(/↔|→|<->|->/);
    for (const side of sides) {
      const ref = side.trim();
      if (!ref) continue;
      const [chapter, topic] = ref.split('/');
      if (!chapter) continue;
      topics.push({
        chapter: chapter.trim(),
        topic: (topic || '').trim(),
        raw: ref,
      });
    }
  }
  return topics;
}

module.exports = {
  listChapters,
  parseIndexChapters,
  parseConnectionTopics,
};

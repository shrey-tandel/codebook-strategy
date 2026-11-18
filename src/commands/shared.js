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

// Extract connection EDGES from CONNECTIONS.md (chapter-level), for the audit
// command. Like parseConnectionTopics, but keeps each pair as an edge with its
// direction and reason. A chain `a → b → c` yields edges a-b and b-c.
//
// Returns [{ a, b, aRaw, bRaw, directed, reason, line }].
function parseConnectionEdges(content) {
  const edges = [];
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  withoutComments.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('#')) return;
    const op = trimmed.match(/(↔|<->|→|->)/);
    if (!op) return;
    const directed = op[1] === '→' || op[1] === '->';
    const beforeReason = trimmed.split(':')[0];
    const sides = beforeReason
      .split(/↔|<->|→|->/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sides.length < 2) return;
    const reason = trimmed.includes(':')
      ? trimmed.slice(trimmed.indexOf(':') + 1).trim()
      : '';
    for (let k = 0; k < sides.length - 1; k++) {
      edges.push({
        a: sides[k].split('/')[0].trim(),
        b: sides[k + 1].split('/')[0].trim(),
        aRaw: sides[k],
        bRaw: sides[k + 1],
        directed,
        reason,
        line: i + 1,
      });
    }
  });
  return edges;
}

// Parse a chapter's `## Key Files` section into a list of repo-relative source
// paths. Returns null when the chapter has no such heading (the caller skips it
// with a note rather than reporting a finding). Otherwise returns the paths
// wrapped in backticks under that heading — possibly an empty array. Only
// content inside the `## Key Files` section is considered; fenced code blocks
// are ignored so a pasted template example never parses as real entries.
function parseChapterKeyFiles(content) {
  const lines = String(content).split('\n');
  let inFence = false;
  let inSection = false;
  let found = false;
  const files = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (/^key files$/i.test(heading[2].trim())) {
        inSection = true;
        found = true;
      } else if (inSection) {
        inSection = false;
      }
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (!/^[-*]\s+/.test(trimmed)) continue;
    const m = trimmed.match(/`([^`]+)`/);
    if (m) files.push(m[1].trim());
  }
  return found ? files : null;
}

module.exports = {
  listChapters,
  parseIndexChapters,
  parseConnectionTopics,
  parseConnectionEdges,
  parseChapterKeyFiles,
};

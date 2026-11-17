'use strict';

const fs = require('fs');
const path = require('path');

// Directories never scanned.
const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  'coverage', 'vendor', '.venv', '__pycache__', 'book',
];

// Extensions scanned by default. Broad on purpose — shared-resource detection
// is by regex, not by language, so anything textual is fair game.
const DEFAULT_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php',
  '.c', '.h', '.cpp', '.cs', '.swift', '.scala',
  '.sql', '.sh', '.yml', '.yaml', '.json', '.env',
];

// Default shared-resource rules — ON unless disabled. Each rule names a `kind`
// and supplies regex strings whose first defined capture group is the resource
// identifier:
//   write — this module writes/owns the resource (producer side)
//   read  — this module reads/consumes it (consumer side)
//   ref   — undirected reference when read vs write can't be told apart
//
// table/queue are directional (write + read), so they produce the first-class
// write->read "reverse dependency" edges and no undirected noise.
//
// The `table` read rule keeps case-insensitivity (lowercase SQL is common) but
// excludes a following `import`, so Python's `from models import User` is not
// mistaken for a table access.
const DEFAULT_RULES = [
  {
    kind: 'table',
    // INSERT INTO / DELETE FROM / CREATE TABLE are SQL-specific. UPDATE is also
    // an English verb, so it is anchored on the mandatory `SET` clause — that
    // keeps real `UPDATE t SET ...` while rejecting prose like "update the docs".
    write: '\\b(?:INSERT\\s+INTO|DELETE\\s+FROM|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?)\\s+["\'`]?([A-Za-z_][A-Za-z0-9_]*)|\\bUPDATE\\s+["\'`]?([A-Za-z_][A-Za-z0-9_]*)["\'`]?\\s+SET\\b',
    // FROM/JOIN, excluding a following `import` so Python's `from x import y`
    // isn't read as a table access.
    read: '\\b(?:FROM|JOIN)\\s+["\'`]?([A-Za-z_][A-Za-z0-9_]*)\\b(?!\\s+import\\b)',
    flags: 'gi',
  },
  {
    kind: 'queue',
    write: '\\.(?:publish|produce|send|emit|enqueue)\\(\\s*["\'`]([A-Za-z0-9_.\\-/:]+)',
    read: '\\.(?:subscribe|consume|process|handle)\\(\\s*["\'`]([A-Za-z0-9_.\\-/:]+)',
    flags: 'gi',
  },
];

// Opt-in rules — OFF unless listed in the config's `enable` array. These are
// ref-only (undirected) and noisy: one shared var like NODE_ENV across N files
// yields N(N-1)/2 phantom edges, so they are a poor default and never gate CI.
const OPTIONAL_RULES = {
  route: {
    kind: 'route',
    ref: '["\'`](/(?:api|v\\d)/[A-Za-z0-9_\\-/:]+)["\'`]',
    flags: 'g',
  },
  env: {
    kind: 'env',
    ref: 'process\\.env\\.([A-Z][A-Z0-9_]+)',
    flags: 'g',
  },
};

// Repo-internal import/require references. Import-edge resolution is JS/TS-only,
// plus partial support for Python *relative* imports (`from .mod import x`).
// Bare/absolute specifiers are treated as external and ignored.
const IMPORT_PATTERNS = [
  '\\bimport\\s+[^\'"]*from\\s+[\'"]([^\'"]+)[\'"]',
  '\\brequire\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)',
  '\\bexport\\s+[^\'"]*from\\s+[\'"]([^\'"]+)[\'"]',
  '\\bfrom\\s+(\\.[\\w.]*)\\s+import\\b',
];

function loadConfig(cwd) {
  const candidates = [
    path.join(cwd, 'book', 'audit.config.json'),
    path.join(cwd, '.codebook-audit.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { cfg: JSON.parse(fs.readFileSync(p, 'utf8')), path: p };
      }
    } catch (e) {
      return { error: `Could not parse ${p}: ${e.message}` };
    }
  }
  return { cfg: {} };
}

// Merge config over the built-in defaults.
//   enable:   turn on optional built-ins (route, env)
//   disable:  turn off default kinds (table, queue)
//   resources: custom rules; a rule with an existing kind replaces it
function resolveConfig(cfg) {
  const byKind = {};
  for (const r of DEFAULT_RULES) byKind[r.kind] = r;
  for (const k of cfg.enable || []) {
    if (OPTIONAL_RULES[k]) byKind[k] = OPTIONAL_RULES[k];
  }
  for (const k of cfg.disable || []) delete byKind[k];
  if (Array.isArray(cfg.resources)) {
    for (const r of cfg.resources) if (r && r.kind) byKind[r.kind] = r;
  }
  return {
    ignore: DEFAULT_IGNORE.concat(cfg.ignore || []),
    extensions: cfg.extensions || DEFAULT_EXTENSIONS,
    moduleDepth: Number.isInteger(cfg.moduleDepth) ? cfg.moduleDepth : 2,
    rules: Object.values(byKind),
  };
}

function walkFiles(root, conf) {
  const out = [];
  const ignore = new Set(conf.ignore);
  (function recurse(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ignore.has(ent.name) || ent.name.startsWith('.')) continue;
        recurse(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (conf.extensions.includes(ext) || conf.extensions.includes(ent.name)) {
          out.push(full);
        }
      }
    }
  })(root);
  return out;
}

// A file's module id: its directory relative to root, capped to moduleDepth
// segments. Two safeguards keep sibling files distinct:
//   - a repo-root file uses its basename (no extension);
//   - a file shallower than the cap (e.g. everything directly under src/) would
//     collapse to one broad bucket, so its basename is appended. Without this a
//     flat `src/*.js` layout maps every file to `src`, and the a===b edge guard
//     then silently drops every edge.
function moduleOf(relPath, moduleDepth) {
  const segs = relPath.split(path.sep).join('/').split('/');
  const dirSegs = segs.slice(0, -1);
  const baseNoExt = segs[segs.length - 1].replace(/\.[^.]+$/, '');
  if (dirSegs.length === 0) return baseNoExt;
  const depth = moduleDepth > 0 ? moduleDepth : dirSegs.length;
  if (dirSegs.length < depth) {
    return dirSegs.join('/') + '/' + baseNoExt;
  }
  return dirSegs.slice(0, depth).join('/');
}

function firstGroup(match) {
  return match.slice(1).find((g) => g !== undefined);
}

// Maps a rule mode to its bucket on a resource entry.
const BUCKET = { write: 'writers', read: 'readers', ref: 'refs' };

// Resources referenced by one file's content.
function extractResources(content, rules) {
  const found = [];
  for (const rule of rules) {
    for (const mode of ['write', 'read', 'ref']) {
      if (!rule[mode]) continue;
      let re;
      try {
        re = new RegExp(rule[mode], rule.flags || 'g');
      } catch (e) {
        continue;
      }
      for (const m of content.matchAll(re)) {
        const id = firstGroup(m);
        if (id) found.push({ id: `${rule.kind}:${id}`, kind: rule.kind, mode });
      }
    }
  }
  return found;
}

// Convert an import specifier to a JS-style relative path, or null if external.
function toRelative(target) {
  if (target.startsWith('./') || target.startsWith('../')) return target;
  // Python dotted relative import: leading dots + dotted name, no slash.
  if (/^\.+([A-Za-z_][\w.]*)?$/.test(target)) {
    let i = 0;
    while (target[i] === '.') i++;
    const rest = target.slice(i).replace(/\./g, '/');
    const prefix = i === 1 ? './' : '../'.repeat(i - 1);
    return prefix + rest;
  }
  return null;
}

function resolveImport(fromAbs, target) {
  const rel = toRelative(target);
  if (rel === null) return null;
  const base = path.resolve(path.dirname(fromAbs), rel);
  const tries = [
    base, base + '.js', base + '.ts', base + '.jsx', base + '.tsx',
    base + '.mjs', base + '.cjs', base + '.py',
    path.join(base, 'index.js'), path.join(base, 'index.ts'),
    path.join(base, '__init__.py'),
  ];
  for (const t of tries) {
    try {
      if (fs.statSync(t).isFile()) return t;
    } catch (e) { /* keep trying */ }
  }
  return null;
}

// Scan the repo and derive module-level edges.
// Returns { fileCount, edges }. Each edge:
//   { a, b, directed, kind, details:[...], evidence:'relPath' }
function scanRepo(root, conf) {
  const files = walkFiles(root, conf);
  const fileModule = new Map();   // absPath -> module id
  const contents = new Map();     // absPath -> text
  const resourceMap = new Map();  // resource id -> { writers, readers, refs, kind }
  const edgeMap = new Map();      // key -> edge
  const importRes = IMPORT_PATTERNS.map((p) => new RegExp(p, 'g'));

  // Pass 1: module of each file + resource references.
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const mod = moduleOf(rel, conf.moduleDepth);
    fileModule.set(abs, mod);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      continue;
    }
    contents.set(abs, text);

    for (const r of extractResources(text, conf.rules)) {
      let entry = resourceMap.get(r.id);
      if (!entry) {
        entry = { writers: new Map(), readers: new Map(), refs: new Map(), kind: r.kind };
        resourceMap.set(r.id, entry);
      }
      const bucket = entry[BUCKET[r.mode]];
      if (bucket && !bucket.has(mod)) bucket.set(mod, rel);
    }
  }

  function addEdge(a, b, directed, kind, detail, evidence) {
    if (a === b) return;
    const key = directed
      ? `${a}=>${b}|${kind}`
      : [a, b].sort().join('--') + `|${kind}`;
    let e = edgeMap.get(key);
    if (!e) {
      const [na, nb] = directed ? [a, b] : [a, b].slice().sort();
      e = { a: na, b: nb, directed, kind, details: new Set(), evidence };
      edgeMap.set(key, e);
    }
    e.details.add(detail);
  }

  // Pass 2: import edges (JS/TS + partial Python relative).
  for (const abs of files) {
    const text = contents.get(abs);
    if (!text) continue;
    const fromMod = fileModule.get(abs);
    for (const re of importRes) {
      for (const m of text.matchAll(re)) {
        const target = firstGroup(m);
        if (!target) continue;
        const resolved = resolveImport(abs, target);
        if (!resolved || !fileModule.has(resolved)) continue;
        addEdge(fromMod, fileModule.get(resolved), false, 'import', target, path.relative(root, abs));
      }
    }
  }

  // Pass 3: shared-resource edges, including reverse write->read.
  for (const [id, entry] of resourceMap) {
    const writers = [...entry.writers.keys()];
    const readers = [...entry.readers.keys()];
    const refs = [...entry.refs.keys()];

    for (const w of writers) {
      for (const r of readers) {
        addEdge(w, r, true, `data:${entry.kind}`, id, entry.writers.get(w));
      }
    }

    // Undirected coupling among plain references (only when a `ref` side exists;
    // table/queue have no ref mode, so this stays quiet by default).
    const all = [...new Set([...writers, ...readers, ...refs])];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const directedAlready =
          (entry.writers.has(all[i]) && entry.readers.has(all[j])) ||
          (entry.writers.has(all[j]) && entry.readers.has(all[i]));
        if (directedAlready) continue;
        if (refs.includes(all[i]) || refs.includes(all[j])) {
          addEdge(all[i], all[j], false, `shared:${entry.kind}`, id,
            entry.refs.get(all[i]) || entry.refs.get(all[j]));
        }
      }
    }
  }

  const edges = [...edgeMap.values()].map((e) => ({
    a: e.a, b: e.b, directed: e.directed, kind: e.kind,
    details: [...e.details], evidence: e.evidence,
  }));

  return { fileCount: files.length, edges };
}

module.exports = {
  DEFAULT_IGNORE,
  DEFAULT_EXTENSIONS,
  DEFAULT_RULES,
  OPTIONAL_RULES,
  loadConfig,
  resolveConfig,
  scanRepo,
  moduleOf,
};

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { exists } = require('../utils/file-writer');
const { green, yellow, red, cyan, dim, bold } = require('../utils/colors');
const { parseConnectionEdges, listChapters, parseChapterKeyFiles } = require('./shared');
const { loadConfig, resolveConfig, scanRepo } = require('../utils/audit-scan');

// Normalized word tokens for fuzzy node matching (module paths vs chapter names).
function tokens(s) {
  return new Set(
    String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  );
}

function nodesMatch(codeModule, chapterName) {
  const a = tokens(codeModule);
  const b = tokens(chapterName);
  for (const t of a) if (b.has(t)) return true;
  for (const x of a) {
    for (const y of b) {
      if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) {
        return true;
      }
    }
  }
  return false;
}

function edgeMatch(codeEdge, bookEdge) {
  const direct = nodesMatch(codeEdge.a, bookEdge.a) && nodesMatch(codeEdge.b, bookEdge.b);
  const swap = nodesMatch(codeEdge.a, bookEdge.b) && nodesMatch(codeEdge.b, bookEdge.a);
  return direct || swap;
}

function arrow(directed) {
  return directed ? '→' : '↔';
}

function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x);
    (out[k] = out[k] || []).push(x);
  }
  return out;
}

// --- git helpers (deterministic; no fs mtime fallback) ---

function isGitRepo(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch (_) {
    return false;
  }
}

// Unix seconds of the last commit that touched relPath, or null if the file is
// untracked / has no commits. Never falls back to filesystem mtime (which resets
// on clone and would report false staleness).
function gitCommitTime(cwd, relPath) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'log', '-1', '--format=%ct', '--', relPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const t = parseInt(out.trim(), 10);
    return Number.isFinite(t) ? t : null;
  } catch (_) {
    return null;
  }
}

// --- stale-chapter check (existence is hard; git-mtime is an opt-in warning) ---

function auditChapters(cwd, bookDir, checkMtime) {
  const chaptersDir = path.join(bookDir, 'chapters');
  const missingFiles = []; // { chapter, file } — referenced path no longer exists (HARD)
  const newerFiles = [];   // { chapter, file } — source committed after the chapter (WARNING)
  const skipped = [];      // chapter files with no `## Key Files` section
  const gitRepo = checkMtime ? isGitRepo(cwd) : false;

  for (const file of listChapters(bookDir)) {
    const chapterPath = path.join(chaptersDir, file);
    const keyFiles = parseChapterKeyFiles(fs.readFileSync(chapterPath, 'utf8'));
    if (keyFiles === null) {
      skipped.push(file);
      continue;
    }
    const chapterCommit =
      checkMtime && gitRepo ? gitCommitTime(cwd, path.relative(cwd, chapterPath)) : null;
    for (const rel of keyFiles) {
      const abs = path.resolve(cwd, rel);
      if (!exists(abs)) {
        missingFiles.push({ chapter: file, file: rel });
        continue;
      }
      if (checkMtime && gitRepo && chapterCommit != null) {
        const srcCommit = gitCommitTime(cwd, rel);
        if (srcCommit != null && srcCommit > chapterCommit) {
          newerFiles.push({ chapter: file, file: rel });
        }
      }
    }
  }
  return { missingFiles, newerFiles, skipped, gitRepo, checkMtime };
}

function audit(args) {
  const argv = args || [];
  const strict = argv.some((a) => a === '--ci' || a === '--strict');
  const checkMtime = argv.some((a) => a === '--check-mtime');
  const cwd = process.cwd();
  const bookDir = path.join(cwd, 'book');
  const connPath = path.join(bookDir, 'CONNECTIONS.md');

  if (!exists(bookDir)) {
    process.stderr.write(
      red('No book/ directory found.') + '\n' +
      dim('Run `npx codebook-strategy init` first.') + '\n'
    );
    return 1;
  }
  if (!exists(connPath)) {
    process.stderr.write(red('book/CONNECTIONS.md is missing.') + '\n');
    return 1;
  }

  const loaded = loadConfig(cwd);
  if (loaded.error) {
    process.stderr.write(red(loaded.error) + '\n');
    return 1;
  }
  const conf = resolveConfig(loaded.cfg);

  const bookEdges = parseConnectionEdges(fs.readFileSync(connPath, 'utf8'));
  const { fileCount, edges: codeEdges } = scanRepo(cwd, conf);

  const missing = codeEdges.filter((ce) => !bookEdges.some((be) => edgeMatch(ce, be)));
  const stale = bookEdges.filter((be) => !codeEdges.some((ce) => edgeMatch(ce, be)));
  const chap = auditChapters(cwd, bookDir, checkMtime);
  const chapterCount = listChapters(bookDir).length;

  // --- Header ---
  process.stdout.write('\n' + bold('Codebook audit') + '\n');
  process.stdout.write(
    dim(`  Scanned ${fileCount} files · ${codeEdges.length} code edges · ` +
        `${bookEdges.length} book edges · ${chapterCount} chapters · ` +
        (loaded.path ? `config ${path.relative(cwd, loaded.path)}` : 'built-in rules') +
        ` · rules: ${conf.rules.map((r) => r.kind).join(', ')}`) + '\n'
  );

  const connClean = missing.length === 0 && stale.length === 0;
  const chapClean = chap.missingFiles.length === 0 && chap.newerFiles.length === 0;

  if (connClean && chapClean) {
    process.stdout.write('\n  ' + green('✓') + ' Book matches the code.\n');
    if (chap.skipped.length) {
      process.stdout.write(
        '  ' + dim(`(${chap.skipped.length} chapter(s) skipped — no parseable key-files section: ` +
          `${chap.skipped.join(', ')})`) + '\n'
      );
    }
    process.stdout.write('\n');
    return 0;
  }

  // --- Section 1: missing connections ---
  if (missing.length > 0) {
    process.stdout.write('\n' + bold('1. Missing connections') +
      dim(' — in the code but not in CONNECTIONS.md') + '\n');
    const byKind = groupBy(missing, (e) => e.kind);
    for (const kind of Object.keys(byKind).sort()) {
      process.stdout.write(dim(`  [${kind}]`) + '\n');
      for (const e of byKind[kind]) {
        const det = e.details.slice(0, 3).join(', ') + (e.details.length > 3 ? '…' : '');
        process.stdout.write(
          '    ' + red('+') + ` ${e.a} ${arrow(e.directed)} ${e.b}` +
          dim(`  (${det}; e.g. ${e.evidence})`) + '\n'
        );
      }
    }
  }

  // --- Section 2: stale connections ---
  if (stale.length > 0) {
    process.stdout.write('\n' + bold('2. Stale connections') +
      dim(' — in CONNECTIONS.md but with no code evidence') + '\n');
    for (const e of stale) {
      process.stdout.write(
        '    ' + yellow('?') + ` ${e.aRaw} ${arrow(e.directed)} ${e.bRaw}` +
        dim(e.reason ? `  (${e.reason})` : '') +
        dim(`  [CONNECTIONS.md:${e.line}]`) + '\n'
      );
    }
  }

  // --- Section 3: stale chapters ---
  if (chap.missingFiles.length > 0 || chap.newerFiles.length > 0 || chap.skipped.length > 0) {
    process.stdout.write('\n' + bold('3. Stale chapters') +
      dim(' — referenced source files that are gone or newer than the chapter') + '\n');
    for (const f of chap.missingFiles) {
      process.stdout.write(
        '    ' + red('✗') + ` ${f.chapter}` + dim(' references ') + f.file +
        ' ' + red('(file not found)') + '\n'
      );
    }
    if (checkMtime) {
      for (const f of chap.newerFiles) {
        process.stdout.write(
          '    ' + yellow('!') + ` ${f.chapter}: ` + f.file +
          dim(' changed after the chapter (code newer than doc)') + '\n'
        );
      }
    }
    if (chap.skipped.length > 0) {
      process.stdout.write(
        '    ' + dim(`skipped (no parseable key-files section): ${chap.skipped.join(', ')}`) + '\n'
      );
    }
    if (!checkMtime) {
      process.stdout.write(
        '    ' + dim('git-mtime warnings off — pass --check-mtime to flag code newer than its chapter.') + '\n'
      );
    } else if (!chap.gitRepo) {
      process.stdout.write(
        '    ' + dim('not a git repo — skipped the git-mtime staleness check (no fs-mtime fallback).') + '\n'
      );
    }
  }

  // --- Agent-ready instruction block (opt-in; the audit itself spends no tokens) ---
  process.stdout.write('\n' + bold('Hand this to your LLM to reconcile:') + '\n\n');
  process.stdout.write(dim('--- BEGIN AGENT INSTRUCTIONS ---') + '\n');
  process.stdout.write(buildInstructionBlock(missing, stale, chap));
  process.stdout.write(dim('--- END AGENT INSTRUCTIONS ---') + '\n');

  // Default is report-only. --ci/--strict fails on hard findings only:
  // missing connections and missing chapter files. mtime warnings never fail.
  const hardFail = missing.length > 0 || chap.missingFiles.length > 0;
  if (hardFail && !strict) {
    process.stdout.write(
      '\n' + dim('  Report-only (exit 0). Pass --ci (or --strict) to fail on missing ' +
        'connections or missing chapter files.') + '\n'
    );
  }
  process.stdout.write('\n');

  return strict && hardFail ? 1 : 0;
}

function buildInstructionBlock(missing, stale, chap) {
  const lines = [];
  lines.push(
    'A deterministic scan compared book/CONNECTIONS.md and the chapters against the',
    'code. For each candidate below, confirm it against the actual source before',
    'changing anything. The scan is heuristic — do not trust it blindly.',
    ''
  );
  if (missing.length) {
    lines.push('CANDIDATE CONNECTIONS FOUND IN CODE BUT NOT IN THE BOOK:');
    for (const e of missing) {
      lines.push(
        `- ${e.a} ${arrow(e.directed)} ${e.b}  [${e.kind}]  evidence: ` +
        `${e.details.slice(0, 3).join(', ')} (see ${e.evidence})`
      );
    }
    lines.push(
      '',
      'For each confirmed one: map the modules to their chapters, add the edge to',
      'book/CONNECTIONS.md as `source/topic → target/topic : reason`, and update the',
      'affected chapter(s). Pay special attention to write→read data edges: a module that',
      'READS a table/queue another module WRITES is a real dependency even with no import.',
      ''
    );
  }
  if (stale.length) {
    lines.push('BOOK CONNECTIONS WITH NO CODE EVIDENCE (verify, then fix or remove):');
    for (const e of stale) {
      lines.push(`- ${e.aRaw} ${arrow(e.directed)} ${e.bRaw}  [CONNECTIONS.md:${e.line}]`);
    }
    lines.push(
      '',
      'If the relationship genuinely no longer exists, remove the line and note it in the',
      'chapter. If it exists via a path the scan missed, leave it.',
      ''
    );
  }
  if (chap.missingFiles.length || chap.newerFiles.length) {
    lines.push('STALE CHAPTERS (a chapter\'s `## Key Files` path is gone or out of date):');
    for (const f of chap.missingFiles) {
      lines.push(`- ${f.chapter}: references ${f.file} — FILE NOT FOUND (move/rename or drop it)`);
    }
    for (const f of chap.newerFiles) {
      lines.push(`- ${f.chapter}: ${f.file} changed after the chapter — re-read and refresh the chapter`);
    }
    lines.push(
      '',
      'Open each chapter, reconcile its `## Key Files` list and prose with the current',
      'source, then save it so its timestamp moves forward.',
      ''
    );
  }
  lines.push('After edits, re-run `npx codebook-strategy audit` until it is clean.');
  return lines.join('\n') + '\n';
}

module.exports = audit;

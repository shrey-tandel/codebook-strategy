'use strict';

const fs = require('fs');
const path = require('path');

const { exists } = require('../utils/file-writer');
const { green, yellow, red, cyan, dim, bold } = require('../utils/colors');
const { parseConnectionEdges } = require('./shared');
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

function audit(args) {
  const strict = (args || []).some((a) => a === '--ci' || a === '--strict');
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

  // --- Report ---
  process.stdout.write('\n' + bold('Codebook audit') + '\n');
  process.stdout.write(
    dim(`  Scanned ${fileCount} files · ${codeEdges.length} code edges · ` +
        `${bookEdges.length} book edges · ` +
        (loaded.path ? `config ${path.relative(cwd, loaded.path)}` : 'built-in rules') +
        ` · rules: ${conf.rules.map((r) => r.kind).join(', ')}`) + '\n'
  );

  if (missing.length === 0 && stale.length === 0) {
    process.stdout.write('\n  ' + green('✓') + ' Book connections match the code.\n\n');
    return 0;
  }

  if (missing.length > 0) {
    process.stdout.write('\n' + bold('Edges in code but missing from the book') + '\n');
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

  if (stale.length > 0) {
    process.stdout.write('\n' + bold('Book edges with no code evidence (possibly stale)') + '\n');
    for (const e of stale) {
      process.stdout.write(
        '    ' + yellow('?') + ` ${e.aRaw} ${arrow(e.directed)} ${e.bRaw}` +
        dim(e.reason ? `  (${e.reason})` : '') +
        dim(`  [CONNECTIONS.md:${e.line}]`) + '\n'
      );
    }
  }

  // --- Agent-ready instruction block ---
  process.stdout.write('\n' + bold('Hand this to your LLM to reconcile:') + '\n\n');
  process.stdout.write(dim('--- BEGIN AGENT INSTRUCTIONS ---') + '\n');
  process.stdout.write(buildInstructionBlock(missing, stale));
  process.stdout.write(dim('--- END AGENT INSTRUCTIONS ---') + '\n');

  if (missing.length > 0 && !strict) {
    process.stdout.write(
      '\n' + dim('  Report-only (exit 0). Pass --ci (or --strict) to fail on missing edges.') + '\n'
    );
  }
  process.stdout.write('\n');

  // Default is report-only. Only --ci/--strict turns missing edges into a failure.
  return strict && missing.length > 0 ? 1 : 0;
}

function buildInstructionBlock(missing, stale) {
  const lines = [];
  lines.push(
    'A deterministic scan compared book/CONNECTIONS.md against the code. For each',
    'candidate below, confirm it against the actual source before changing anything.',
    'The scan is heuristic — do not trust it blindly.',
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
  lines.push('After edits, re-run `npx codebook-strategy audit` until it is clean.');
  return lines.join('\n') + '\n';
}

module.exports = audit;

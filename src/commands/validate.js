'use strict';

const fs = require('fs');
const path = require('path');

const { exists } = require('../utils/file-writer');
const { green, yellow, red, dim, bold } = require('../utils/colors');
const {
  listChapters,
  parseIndexChapters,
  parseConnectionTopics,
} = require('./shared');

function validate() {
  const cwd = process.cwd();
  const bookDir = path.join(cwd, 'book');

  if (!exists(bookDir)) {
    process.stderr.write(
      red('No book/ directory found.') +
        '\n' +
        dim('Run `npx codebook-strategy init` first.') +
        '\n'
    );
    return 1;
  }

  const warnings = [];

  const chapters = listChapters(bookDir);
  const chapterBaseNames = chapters.map((c) => c.replace(/\.md$/i, ''));

  // INDEX.md <-> chapter files
  const indexPath = path.join(bookDir, 'INDEX.md');
  let indexNames = [];
  if (exists(indexPath)) {
    indexNames = parseIndexChapters(fs.readFileSync(indexPath, 'utf8'));
  } else {
    warnings.push('INDEX.md is missing.');
  }

  for (const name of indexNames) {
    if (!chapterBaseNames.includes(name)) {
      warnings.push(
        `INDEX.md lists "${name}" but book/chapters/${name}.md does not exist.`
      );
    }
  }
  for (const base of chapterBaseNames) {
    if (!indexNames.includes(base)) {
      warnings.push(
        `book/chapters/${base}.md exists but is not listed in INDEX.md.`
      );
    }
  }

  // CONNECTIONS.md references chapters that exist.
  const connPath = path.join(bookDir, 'CONNECTIONS.md');
  if (exists(connPath)) {
    const topics = parseConnectionTopics(fs.readFileSync(connPath, 'utf8'));
    const known = new Set([...chapterBaseNames, ...indexNames]);
    for (const topic of topics) {
      if (!known.has(topic.chapter)) {
        warnings.push(
          `CONNECTIONS.md references chapter "${topic.chapter}" (in "${topic.raw}") ` +
            `which is not a known chapter.`
        );
      }
    }
  } else {
    warnings.push('CONNECTIONS.md is missing.');
  }

  // Report
  process.stdout.write('\n' + bold('Codebook validation') + '\n\n');
  if (warnings.length === 0) {
    process.stdout.write(
      '  ' + green('✓') + ' No problems found. The book is consistent.\n\n'
    );
    return 0;
  }

  for (const w of warnings) {
    process.stdout.write('  ' + yellow('!') + ' ' + w + '\n');
  }
  process.stdout.write(
    '\n' + dim(`  ${warnings.length} warning(s).`) + '\n\n'
  );
  // Mismatches are warnings, not hard failures; exit non-zero so CI can catch them.
  return 1;
}

module.exports = validate;

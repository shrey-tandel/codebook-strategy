'use strict';

const fs = require('fs');
const path = require('path');

const { exists } = require('../utils/file-writer');
const { green, yellow, red, dim, bold } = require('../utils/colors');
const { listChapters, parseIndexChapters } = require('./shared');

function fmtDate(d) {
  // YYYY-MM-DD HH:MM, local time.
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function status() {
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

  process.stdout.write('\n' + bold('Codebook status') + '\n\n');

  const coreFiles = ['PREFACE.md', 'INDEX.md', 'CONNECTIONS.md'];
  process.stdout.write(bold('Core files') + '\n');
  for (const name of coreFiles) {
    const p = path.join(bookDir, name);
    if (exists(p)) {
      const stat = fs.statSync(p);
      process.stdout.write(
        '  ' + green('present') + ' ' + name + dim(`  (modified ${fmtDate(stat.mtime)})`) + '\n'
      );
    } else {
      process.stdout.write('  ' + red('missing') + ' ' + name + '\n');
    }
  }

  // Chapters on disk.
  const chapters = listChapters(bookDir);
  process.stdout.write('\n' + bold('Chapters') + '\n');
  if (chapters.length === 0) {
    process.stdout.write(dim('  No chapters yet.') + '\n');
  } else {
    for (const ch of chapters) {
      const stat = fs.statSync(path.join(bookDir, 'chapters', ch));
      process.stdout.write(
        '  ' + green('•') + ' ' + ch + dim(`  (modified ${fmtDate(stat.mtime)})`) + '\n'
      );
    }
    process.stdout.write(dim(`  ${chapters.length} chapter(s) total.`) + '\n');
  }

  // Warn about index entries that have no matching chapter file.
  const indexPath = path.join(bookDir, 'INDEX.md');
  if (exists(indexPath)) {
    const indexNames = parseIndexChapters(fs.readFileSync(indexPath, 'utf8'));
    const chapterBaseNames = chapters.map((c) => c.replace(/\.md$/i, ''));
    const orphans = indexNames.filter(
      (n) => !chapterBaseNames.includes(n)
    );
    if (orphans.length > 0) {
      process.stdout.write('\n' + bold('Warnings') + '\n');
      for (const name of orphans) {
        process.stdout.write(
          '  ' +
            yellow('!') +
            ` INDEX.md lists "${name}" but book/chapters/${name}.md does not exist\n`
        );
      }
    }
  }

  process.stdout.write('\n');
  return 0;
}

module.exports = status;

'use strict';

const fs = require('fs');
const path = require('path');

const {
  isProject,
  detectPresent,
  resolveTargets,
  ALL_KEYS,
} = require('../utils/detect-environment');
const {
  exists,
  ensureDir,
  writeIfAbsent,
  appendSection,
  removeDir,
} = require('../utils/file-writer');
const { green, yellow, red, cyan, bold, dim } = require('../utils/colors');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates');
// Any config file that already contains this marker is considered to already
// have the strategy injected.
const STRATEGY_MARKER = 'Codebook Strategy';

// The book files that get scaffolded, relative to the book/ directory.
const BOOK_FILES = ['PREFACE.md', 'INDEX.md', 'CONNECTIONS.md'];

function read(templatePath) {
  return fs.readFileSync(path.join(TEMPLATES, templatePath), 'utf8');
}

// Read the value of a flag, supporting both `--flag value` and `--flag=value`.
function getFlagValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === name) return args[i + 1];
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
  }
  return undefined;
}

function init(args) {
  const force = args.includes('--force');
  const toolArg = getFlagValue(args, '--tool');
  const cwd = process.cwd();

  if (!isProject(cwd)) {
    process.stderr.write(
      red('This does not look like a project directory.') +
        '\n' +
        dim('Expected a package.json, .git, or src/ here. Run init from your project root.') +
        '\n'
    );
    return 1;
  }

  // Resolve which agents to write to. Default: every supported agent, so it
  // never matters which one (or how many) the developer actually uses.
  const { targets, invalid } = resolveTargets(toolArg);
  if (invalid.length > 0) {
    process.stderr.write(
      red(`Unknown --tool value(s): ${invalid.join(', ')}`) +
        '\n' +
        dim(`Valid tools: ${ALL_KEYS.join(', ')}, or all.`) +
        '\n'
    );
    return 1;
  }

  const bookDir = path.join(cwd, 'book');

  // Handle an existing book/ directory.
  if (exists(bookDir)) {
    if (force) {
      removeDir(bookDir);
      process.stdout.write(yellow('Removed existing book/ (--force).') + '\n');
    } else {
      process.stdout.write(
        yellow('book/ already exists. ') +
          dim('Re-run with --force to overwrite, or leave it as is.') +
          '\n'
      );
      // Still run config injection below — that part is append-safe — but do
      // not touch existing book files.
    }
  }

  // --- Scaffold the book directory --------------------------------------
  ensureDir(bookDir);
  ensureDir(path.join(bookDir, 'chapters'));

  const bookResults = [];
  for (const name of BOOK_FILES) {
    const result = writeIfAbsent(
      path.join(bookDir, name),
      read(path.join('book', name))
    );
    bookResults.push({ name: `book/${name}`, result });
  }
  // Keep the chapters directory tracked even when empty.
  const keepResult = writeIfAbsent(
    path.join(bookDir, 'chapters', '.gitkeep'),
    ''
  );
  bookResults.push({ name: 'book/chapters/', result: keepResult });

  // --- Inject strategy into config files --------------------------------
  // Which agents actually show signs of use here (for reporting only).
  const present = detectPresent(cwd);

  const configResults = [];
  for (const target of targets) {
    const section = read(target.template);
    const filePath = path.join(cwd, target.file);
    const result = appendSection(filePath, section, STRATEGY_MARKER);
    configResults.push({
      key: target.key,
      tool: target.tool,
      file: target.file,
      result,
      detected: present.includes(target.key),
    });
  }

  // --- Report -----------------------------------------------------------
  process.stdout.write('\n' + bold('Codebook Strategy initialized') + '\n\n');

  process.stdout.write(bold('Book files') + '\n');
  for (const { name, result } of bookResults) {
    process.stdout.write('  ' + formatResult(result) + ' ' + name + '\n');
  }

  process.stdout.write('\n' + bold('Config files') + '\n');
  if (toolArg) {
    process.stdout.write(
      dim('  Injecting strategy into the tool(s) you selected:') + '\n'
    );
  } else {
    process.stdout.write(
      dim('  Covering every supported agent (pass --tool to narrow):') + '\n'
    );
  }
  for (const { tool, file, result, detected } of configResults) {
    const mark = detected ? cyan('  ← in use here') : '';
    process.stdout.write(
      '  ' + formatResult(result) + ' ' + file + dim(` (${tool})`) + mark + '\n'
    );
  }

  process.stdout.write('\n' + bold('Next steps') + '\n');
  process.stdout.write(
    '  1. Open your LLM coding tool in this project.\n' +
      '  2. Tell it: ' +
      cyan('"Implement the book strategy"') +
      '\n' +
      '  3. It will scan the codebase and fill in the book.\n\n'
  );

  return 0;
}

function formatResult(result) {
  switch (result) {
    case 'created':
      return green('created ');
    case 'appended':
      return green('appended');
    case 'skipped':
      return yellow('skipped ');
    case 'present':
      return yellow('present ');
    default:
      return dim(result);
  }
}

module.exports = init;

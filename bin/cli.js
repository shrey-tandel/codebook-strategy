#!/usr/bin/env node
'use strict';

const init = require('../src/commands/init');
const status = require('../src/commands/status');
const validate = require('../src/commands/validate');
const audit = require('../src/commands/audit');
const { red, bold, dim } = require('../src/utils/colors');

const HELP = `
${bold('codebook-strategy')} — a structured context system for LLM-assisted development

${bold('Usage')}
  npx codebook-strategy <command> [options]

${bold('Commands')}
  init        Scaffold the /book/ directory and inject strategy instructions
  status      Show which book files exist and their state
  validate    Check the book for index/chapter/connection mismatches
  audit       Scan for drift: missing/stale connections and stale chapters

${bold('Options for init')}
  --tool <list>   Which agents to set up: claude, cursor, agents, or all.
                  Comma-separated. Default: all (covers every agent).
  --force         Overwrite an existing book/ directory

${bold('Options for audit')}
  --ci, --strict  Exit non-zero on missing connections or missing chapter files.
                  Default is report-only (exit 0). Reads optional
                  book/audit.config.json for custom resource rules.
  --check-mtime   Also warn when a chapter's source file is newer than the
                  chapter (git commit times; skipped if not a git repo).
                  Warnings never fail --ci.

${bold('After init')}
  Tell your LLM: ${dim('"Implement the book strategy"')}
`;

function main(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case 'init':
      return init(rest);
    case 'status':
      return status(rest);
    case 'validate':
      return validate(rest);
    case 'audit':
      return audit(rest);
    case '-h':
    case '--help':
    case 'help':
    case undefined:
      process.stdout.write(HELP + '\n');
      return 0;
    default:
      process.stderr.write(red(`Unknown command: ${command}`) + '\n');
      process.stdout.write(HELP + '\n');
      return 1;
  }
}

const code = main(process.argv);
process.exit(typeof code === 'number' ? code : 0);

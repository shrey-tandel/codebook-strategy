'use strict';

const path = require('path');
const { exists } = require('./file-writer');

// Decide whether the current working directory looks like a real project.
function isProject(cwd) {
  return (
    exists(path.join(cwd, 'package.json')) ||
    exists(path.join(cwd, '.git')) ||
    exists(path.join(cwd, 'src'))
  );
}

// Detect which LLM tool config files/directories are present.
// Returns a list of target descriptors. Each descriptor names the config file
// the strategy should be injected into and the template it comes from.
//
// If nothing is detected, all three targets are returned so the book works with
// whichever tool the developer uses.
function detectTargets(cwd) {
  const claude =
    exists(path.join(cwd, 'CLAUDE.md')) || exists(path.join(cwd, '.claude'));
  const cursor =
    exists(path.join(cwd, '.cursorrules')) || exists(path.join(cwd, '.cursor'));
  const agents = exists(path.join(cwd, 'AGENTS.md'));

  const all = {
    claude: { tool: 'Claude Code', file: 'CLAUDE.md', template: 'CLAUDE.md' },
    cursor: { tool: 'Cursor', file: '.cursorrules', template: 'cursorrules' },
    agents: { tool: 'Amp/Warp', file: 'AGENTS.md', template: 'AGENTS.md' },
  };

  const detected = [];
  if (claude) detected.push(all.claude);
  if (cursor) detected.push(all.cursor);
  if (agents) detected.push(all.agents);

  if (detected.length > 0) {
    return { detected: true, targets: detected };
  }

  return { detected: false, targets: [all.claude, all.cursor, all.agents] };
}

module.exports = {
  isProject,
  detectTargets,
};

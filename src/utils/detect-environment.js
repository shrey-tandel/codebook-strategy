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

// The coding agents we support. Each entry names the config file the strategy
// is injected into, the template it comes from, and the filesystem "signals"
// that hint the agent is in use here.
const TOOLS = {
  claude: {
    key: 'claude',
    tool: 'Claude Code',
    file: 'CLAUDE.md',
    template: 'CLAUDE.md',
    signals: ['CLAUDE.md', '.claude'],
  },
  cursor: {
    key: 'cursor',
    tool: 'Cursor',
    file: '.cursorrules',
    template: 'cursorrules',
    signals: ['.cursorrules', '.cursor'],
  },
  agents: {
    key: 'agents',
    tool: 'Amp / Warp / Codex (AGENTS.md)',
    file: 'AGENTS.md',
    template: 'AGENTS.md',
    signals: ['AGENTS.md'],
  },
};

const ALL_KEYS = ['claude', 'cursor', 'agents'];

// Accept a few friendly spellings for the --tool flag.
const ALIASES = {
  claude: 'claude',
  'claude-code': 'claude',
  claudecode: 'claude',
  cc: 'claude',
  cursor: 'cursor',
  agents: 'agents',
  agent: 'agents',
  'agents.md': 'agents',
  amp: 'agents',
  warp: 'agents',
  codex: 'agents',
};

// Which agents show signs of being used in this project. Informational only —
// by default we still write to every agent so nothing is missed.
function detectPresent(cwd) {
  return ALL_KEYS.filter((key) =>
    TOOLS[key].signals.some((s) => exists(path.join(cwd, s)))
  );
}

// Resolve which config files to write to.
//
//   toolArg undefined / null  -> all agents (the safe default)
//   toolArg 'all'             -> all agents
//   toolArg 'claude,cursor'   -> just those (comma- or space-separated, aliases ok)
//
// Returns { targets: [toolDescriptor], invalid: [badToken] }.
function resolveTargets(toolArg) {
  if (!toolArg || String(toolArg).trim().toLowerCase() === 'all') {
    return { targets: ALL_KEYS.map((k) => TOOLS[k]), invalid: [] };
  }

  const tokens = String(toolArg)
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const keys = [];
  const invalid = [];
  for (const t of tokens) {
    if (t === 'all') {
      for (const k of ALL_KEYS) if (!keys.includes(k)) keys.push(k);
      continue;
    }
    const k = ALIASES[t];
    if (!k) {
      invalid.push(t);
    } else if (!keys.includes(k)) {
      keys.push(k);
    }
  }

  return { targets: keys.map((k) => TOOLS[k]), invalid };
}

module.exports = {
  isProject,
  detectPresent,
  resolveTargets,
  TOOLS,
  ALL_KEYS,
};

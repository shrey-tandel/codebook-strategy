'use strict';

// Minimal ANSI coloring. No dependencies. Disables itself when output is not a
// TTY or when NO_COLOR is set, so piped/redirected output stays clean.

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  Boolean(process.stdout && process.stdout.isTTY);

function wrap(open, close) {
  return function (str) {
    if (!enabled) return String(str);
    return `\u001b[${open}m${str}\u001b[${close}m`;
  };
}

module.exports = {
  enabled,
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  red: wrap(31, 39),
  cyan: wrap(36, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
};

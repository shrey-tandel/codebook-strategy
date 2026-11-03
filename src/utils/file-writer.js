'use strict';

const fs = require('fs');
const path = require('path');

// Safe filesystem helpers. Nothing here overwrites existing content unless the
// caller explicitly opts in.

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch (_) {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Write a file only if it does not already exist.
// Returns 'created' or 'skipped'.
function writeIfAbsent(filePath, content) {
  if (exists(filePath)) return 'skipped';
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return 'created';
}

// Append a section to a file, creating the file if it is absent.
// A separator is inserted before the section when the file already has content.
// Returns 'created' or 'appended'. If the section marker is already present,
// returns 'present' and writes nothing.
function appendSection(filePath, section, marker) {
  if (!exists(filePath)) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, section.replace(/^\n+/, ''));
    return 'created';
  }

  const current = fs.readFileSync(filePath, 'utf8');
  if (marker && current.indexOf(marker) !== -1) {
    return 'present';
  }

  const needsNewline = current.length > 0 && !current.endsWith('\n');
  const separator = `${needsNewline ? '\n' : ''}\n---\n\n`;
  fs.appendFileSync(filePath, separator + section.replace(/^\n+/, ''));
  return 'appended';
}

// Remove a directory and everything in it.
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  exists,
  ensureDir,
  writeIfAbsent,
  appendSection,
  removeDir,
};

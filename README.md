# codebook-strategy

**Your AI coding assistant re-reads your whole codebase every session.** `codebook-strategy` builds a small set of notes it reads instead — so it gets the *right* context, not *all* the context.

> ⚠️ **Run it, don't install it.** This is a one-shot scaffolding CLI, **not** a dependency.
> Use `npx` (or `pnpm dlx`) — do **not** run `npm install codebook-strategy`.

```bash
npx codebook-strategy init
```

Then tell your coding assistant:

> **"Implement the book strategy"**

It scans your codebase once and writes a compact "book" that it reads on every future session — instead of re-crawling every file.

---

## The problem

LLM coding assistants waste tokens. Ask one to fix a bug and it often reads dozens of files just to rebuild an understanding of your project it threw away when the last session ended. That is slow, expensive, and the context it gathers is mostly noise for the task at hand.

## The solution

A **book**: four kinds of file that live in your repo and give the assistant a map it can read cheaply, loading deep detail only for the feature it's actually touching.

```
book/
  PREFACE.md        always read — project-wide patterns
  INDEX.md          always read — every feature and its status
  CONNECTIONS.md    always read — how features depend on each other
  chapters/
    <feature>.md    read on demand — deep context + key files for one feature
```

The three top-level files are small and always loaded. Chapters are detailed but only read when relevant. The assistant goes:

**preface → index → connections → the one or two chapters that matter → the actual source files those chapters point to.**

### The four files

- **PREFACE.md** — Cross-cutting patterns that apply everywhere: tech stack, auth, error handling, logging, API and database conventions, testing. Chapters only note where they *deviate* from the preface.
- **INDEX.md** — A table of every feature/module: name, status, last updated, one-liner. This is how the assistant decides which chapters to open.
- **CONNECTIONS.md** — Topic-level relationships between features (`auth/tenant → billing/invoices`). This is the blast-radius map: what else might break if you change something.
- **chapters/** — One file per feature. Architecture, key files, known issues, recent changes, and a "don't bother reading" list of dead code and fixtures.

## The three protocols

The strategy is enforced by instructions injected into your assistant's config file (`CLAUDE.md`, `.cursorrules`, or `AGENTS.md`):

1. **Reading order** — Always preface → index → connections → relevant chapters → source. Never crawl the whole codebase.
2. **Mismatch protocol** — If the book and the code disagree, *stop* and surface both to you. A stale book gets updated; wrong code might be the actual bug.
3. **Checkpoint protocol** — If a feature or topic isn't in the book, the assistant asks whether to document it after resolving your request — so the book grows as you work.

## How the book matures

It starts as structure and becomes knowledge. `init` lays down empty templates. The bootstrap pass fills them from your current codebase. From then on, every time the assistant touches an undocumented corner, the checkpoint protocol nudges it to write that corner down. Over weeks the book accumulates the hard-won context that normally lives only in senior engineers' heads.

## Commands

### `init`

```bash
npx codebook-strategy init [--force]
```

- Confirms you're in a project (looks for `package.json`, `.git`, or `src/`).
- Detects your LLM tooling and injects the strategy into the right config file:
  - `CLAUDE.md` / `.claude/` → **Claude Code**
  - `.cursorrules` / `.cursor/` → **Cursor**
  - `AGENTS.md` → **Amp / Warp**
  - none detected → creates all three
- Scaffolds `book/` with `PREFACE.md`, `INDEX.md`, `CONNECTIONS.md`, and `chapters/`.
- Existing config files are **appended to**, never overwritten. Existing book files are left untouched unless you pass `--force`.

### `status`

```bash
npx codebook-strategy status
```

Shows which book files exist, when each was last modified, how many chapters there are, and warns if `INDEX.md` lists a chapter that has no file.

### `validate`

```bash
npx codebook-strategy validate
```

Checks the book for consistency:

- every chapter file has an `INDEX.md` entry, and vice versa
- `CONNECTIONS.md` only references chapters that exist

Prints a warning for each mismatch and exits non-zero if any are found, so it fits in CI.

## Works with

Claude Code, Cursor, Amp, Warp — and any LLM tool that reads a project config file. The book itself is just markdown, so any assistant you point at it can follow along.

## Design notes

Zero dependencies. Node.js built-ins only. No build step. The whole tool is plain JavaScript you can read in a few minutes.

## License

MIT

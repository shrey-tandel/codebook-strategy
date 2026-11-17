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
npx codebook-strategy init [--tool <list>] [--force]
```

- Confirms you're in a project (looks for `package.json`, `.git`, or `src/`).
- **Injects the strategy into every supported agent by default** — `CLAUDE.md` (Claude Code), `.cursorrules` (Cursor), and `AGENTS.md` (Amp / Warp / Codex). That way it doesn't matter which agent — or how many — your team uses; whichever one someone opens, it finds the strategy. The agents it detects in use are marked in the output.
- Narrow it with `--tool` if you only want specific agents:
  ```bash
  npx codebook-strategy init --tool claude
  npx codebook-strategy init --tool claude,cursor
  npx codebook-strategy init --tool all        # explicit default
  ```
- Scaffolds `book/` with `PREFACE.md`, `INDEX.md`, `CONNECTIONS.md`, and `chapters/`.
- Existing config files are **appended to**, never overwritten (and never double-injected). Existing book files are left untouched unless you pass `--force`.

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

### `audit`

```bash
npx codebook-strategy audit [--ci]
```

A **manual, whole-repo completeness check** for `CONNECTIONS.md`. Where `validate` only checks internal consistency, `audit` scans the actual code and surfaces real dependencies the book is missing — then hands you an instruction block to reconcile them with your LLM. It never edits the book itself.

**Why it exists:** `CONNECTIONS.md` normally only grows when an agent happens to read a connection mid-task. That misses *reverse dependencies* — e.g. a reporting module that `SELECT`s from a table the ingestion module `INSERT`s into. The two share data but don't import each other, so nothing surfaces the coupling. `audit` is the deliberate check you run on demand, especially **before a schema change**.

What it does:

1. Parses `book/CONNECTIONS.md` into the set of known edges.
2. Deterministically scans the repo (Node built-ins only, no new deps), skipping `node_modules`, `.git`, `build/`, `dist/`, etc. It derives edges from:
   - **cross-module imports**, and
   - **shared resources** via configurable regex — by default DB **table** reads/writes and **queue/topic** publish/subscribe.
3. Builds **write→read directed edges** as first-class output: the module that *reads* a resource another module *writes* is a real dependency even with no import between them. This reverse/shared-data case is the whole point.
4. Diffs code edges against the book and reports **(a)** edges in code but missing from the book, and **(b)** book edges with no code evidence (possibly stale).
5. Prints a grouped report plus a copy-paste **agent instruction block** to confirm each finding and update `CONNECTIONS.md` + the affected chapter.

**Exit code:** report-only by default (exit `0`). Pass `--ci` (or `--strict`) to exit non-zero when code has edges missing from the book, so it can gate CI. Stale book edges are always warnings only.

**Scope — read this:** *shared-resource* detection is language-agnostic (it's just regex over text). *Import-edge* resolution is **JS/TS-only, with partial support for Python relative imports** (`from .mod import x`); imports in other languages are not resolved into edges. Don't rely on import edges outside JS/TS.

**Configuration** — optional `book/audit.config.json` (or `.codebook-audit.json` at the repo root):

```json
{
  "moduleDepth": 2,
  "ignore": ["generated"],
  "extensions": [".js", ".ts", ".go"],
  "enable": ["route", "env"],
  "disable": ["queue"],
  "resources": [
    {
      "kind": "table",
      "write": "\\b(?:INSERT INTO|UPDATE)\\s+([A-Za-z_][A-Za-z0-9_]*)",
      "read": "\\bFROM\\s+([A-Za-z_][A-Za-z0-9_]*)",
      "flags": "gi"
    }
  ]
}
```

- `table` and `queue` rules are **on by default**. `route` and `env` are **opt-in** via `enable` — they're undirected `ref`-only rules and get noisy fast (one shared `NODE_ENV` across N files produces N·(N−1)/2 edges), so they never gate CI and aren't a sensible default.
- `disable` turns off a default kind; `resources` adds custom rules (a rule reusing an existing `kind` replaces it). Each rule's first capture group is the resource id; `write`/`read` are directional, `ref` is undirected.
- `moduleDepth` (default `2`) sets how many path segments form a "module" (`src/reporting/queries.ts` → `src/reporting`). Files shallower than the cap keep their basename so a flat `src/*.js` layout doesn't collapse into one module.

## Works with

Claude Code, Cursor, Amp, Warp — and any LLM tool that reads a project config file. The book itself is just markdown, so any assistant you point at it can follow along.

## Design notes

Zero dependencies. Node.js built-ins only. No build step. The whole tool is plain JavaScript you can read in a few minutes.

## License

MIT

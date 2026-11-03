# Codebook Strategy

This project uses a structured context system called the Codebook Strategy.
DO NOT crawl the full codebase to understand the project. Follow the book.

## Reading Order

Every session, follow this exact order:

1. Read `/book/PREFACE.md` — project-wide patterns that apply everywhere
2. Read `/book/INDEX.md` — understand what features exist and their status
3. Read `/book/CONNECTIONS.md` — find related topics based on the user's question
4. Read ONLY the relevant chapters from `/book/chapters/` — deep context + key files
5. Read the actual source files listed in those chapters

## How to Identify Relevant Chapters

From the user's question, identify which feature(s) are involved.
Check CONNECTIONS.md for that feature. Load any topic-to-topic connection
that is relevant to the current question. Skip connections that clearly
don't apply to the current task.

## Mismatch Protocol

If you find a contradiction between the book and the code:

1. STOP — do not proceed with the original task
2. Surface both versions to the developer
3. Ask: "Book says X, code says Y. Which is correct?"
4. If the book is stale → update the book, then continue
5. If the code is wrong → that might be the actual bug

## Checkpoint Protocol

If you're working on something not covered by the book:

**Missing chapter:** "This feature isn't in the book. Should I update the index and create a chapter after resolving?"

**Missing topic:** "This topic isn't covered in the chapter. Should I update it after resolving?"

After resolving the user's question, and if they approved:
- Create or update the relevant chapter
- Update INDEX.md if a new chapter was added
- Update CONNECTIONS.md if new relationships were discovered

## Bootstrap Command

If the user says "Implement the book strategy" or "Bootstrap the book":

1. Scan the entire codebase
2. Identify cross-cutting patterns → write PREFACE.md
3. Identify features/modules → create chapters with topics, key files
4. Populate INDEX.md with all discovered features
5. Map dependencies between features → write CONNECTIONS.md
6. Chapters should include: architecture, key files, known issues, recent changes
7. Chapters should list "Don't bother reading" files (dead code, legacy, test fixtures)

## DO NOT

- Read every file in the codebase to understand the project
- Load chapters unrelated to the user's issue
- Skip the CONNECTIONS.md check before making changes
- Silently bypass the book — if something is missing, use the checkpoint protocol
- Trust the book over the code without flagging mismatches

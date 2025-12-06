# Context Resume CLI

Context Resume lets you quickly resume work across Claude Code (`~/.claude`) and Codex CLI (`~/.codex`) by listing recent sessions for the current working directory, showing a short preview, and printing a ready-to-use resume prompt that points to the original `.jsonl` log.

## Features
- Merges Claude and Codex sessions for the current directory, sorted by recency (top 20).
- Live preview of session content; title is taken from the first user message.
- Press Enter to print a Chinese resume prompt containing the session file path (no extra formatting), so another agent can read the file directly.
- Works locally; no network calls.

## Requirements
- Node.js 18+ (tested with ESM build).

## Installation
```bash
npm install
npm run build
npm link      # optional, to install the global `context` command
```

## Usage
From any project directory you want to resume:
```bash
context
```
- Use arrow keys to select a session; preview shows truncated content (500 chars window).
- Press Enter: the CLI writes a resume prompt with the absolute path to the session `.jsonl` and exits. Copy that prompt into your agent to restore context.
- Flags: `-h/--help`, `-v/--version`.

## How it works
- Claude: reads `~/.claude/projects/<encoded-path>/*.jsonl` where path is `/` replaced by `-`. Picks recent files by mtime, builds preview from user/assistant/system lines.
- Codex: scans `~/.codex/sessions/**/*.jsonl`, filters files whose first line has `{"type":"session_meta","payload":{"cwd":<current cwd>}}`, and sorts by mtime. Preview currently focuses on user inputs.
- Preview is truncated via a start/end window; full content is kept in the source file referenced in the prompt.

## Project layout
- `src/index.tsx` – Commander entrypoint, renders Ink UI.
- `src/ui/app.tsx` – Two-pane UI: list on the left, preview on the right; prints the resume prompt on selection.
- `src/adapters/index.ts` – File parsers for Claude and Codex sessions.
- `docs/context_structure_analysis.md` – Chinese write-up of `.claude` and `.codex` storage structure.

## Limitations
- Codex parsing only pulls user messages for previews; assistant replies are not yet shown.
- Scans up to 20 most recent sessions; very large histories in `.codex` may still be slow due to globbing.
- No tests yet; run `npm run build` to verify types and emit `dist/`.

# Context Resume CLI

Context Resume lets you quickly resume work across Claude Code (`~/.claude`), Codex CLI (`~/.codex`), Cursor (`~/.cursor`), and Gemini (`~/.gemini`) by listing recent sessions for the current working directory, showing a detailed prompt history preview, and printing a ready-to-use bilingual (English/Chinese) resume prompt.

## Features
- **Quad-Panel View**: Grid view for Claude, Codex, Cursor, and Gemini sessions.
- **Detailed Preview**: Shows a list of user prompts from the selected session (truncated) at the top.
- **Configurable Limit**: Use `-n <count>` to control how many sessions to load per source.
- **Bilingual Output**: Prints both English and Chinese prompts pointing to the session file.
- **Privacy First**: Works entirely locally; no network calls.

## Requirements
- Node.js 18+ (tested with ESM build).
- `sqlite3` command-line tool (required for reading Cursor sessions).

## Installation
```bash
npm install
npm run build
npm link      # optional, to install the global `context` command
```

## Usage
From any project directory you want to resume:
```bash
context           # Load default 10 sessions per source
context -n 20     # Load 20 sessions per source
```
- Use **TAB** to switch between panels.
- Use **Arrow Keys** to navigate grid (Left/Right) and select sessions (Up/Down).
- Preview at the top shows the sequence of user prompts.
- Press **Enter** to print the resume prompts (with absolute paths) and exit.

## How it works
- **Claude**: Reads `~/.claude/projects/<encoded-path>/*.jsonl`.
- **Codex**: Scans `~/.codex/sessions/**/*.jsonl`, filters by `cwd` metadata.
- **Cursor**: Scans `~/.cursor/chats/<md5-hash>/*/store.db`, extracts prompts from SQLite `blobs`.
- **Gemini**: Scans `~/.gemini/tmp/<sha256-hash>/chats/*.json`.
- **Prompt Extraction**: Parses the session files to extract user inputs for the preview, giving you a quick summary of "what was I doing?".

## Project layout
- `src/index.tsx` – Entry point, handles CLI arguments.
- `src/ui/app.tsx` – Ink UI with grid panels and preview.
- `src/adapters/index.ts` – File parsers and prompt extractors.

## Limitations
- Codex scanning involves globbing which might be slow on very large histories.
- Cursor support requires `sqlite3` installed in the system.

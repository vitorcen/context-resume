#!/usr/bin/env node

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import App from './ui/app.js';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { getClaudeSessions, getCodexSessions, getCursorDebugInfo, getCursorSessions } from './adapters/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('context')
  .description('Context Resume CLI')
  .version(version, '-v, --version');

program
  .option('-n, --number <count>', 'Number of sessions to show per source (claude/codex)', '10')
  .action(async (options) => {
    const cwd = process.cwd();
    const limit = parseInt(options.number, 10) || 10;

    let selectionOutput = '';

    const app = render(
      <App
        cwd={cwd}
        limit={limit}
        onSubmit={(output) => {
          selectionOutput = output;
        }}
      />
    );

    await app.waitUntilExit();

    if (selectionOutput) {
      app.clear();
      process.stdout.write(selectionOutput);
    }
  });

const expandHome = (inputPath: string): string => {
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
};

const printSessions = (label: string, sessions: { title: string; path: string }[]) => {
  console.log(`${label}: ${sessions.length}`);
  sessions.forEach((session, i) => {
    console.log(`${i + 1}. ${session.title} | ${session.path}`);
  });
};

program
  .command('codex')
  .argument('[path]', 'Workspace path', process.cwd())
  .option('-n, --number <count>', 'Number of sessions to show', '10')
  .description('Debug Codex sessions for a path')
  .action(async (targetPath, options) => {
    const resolvedPath = expandHome(targetPath);
    const limit = parseInt(options.number, 10) || 10;
    const sessions = await getCodexSessions(resolvedPath, limit);
    console.log(`Codex debug`);
    console.log(`cwd: ${resolvedPath}`);
    printSessions('sessions', sessions);
  });

program
  .command('claude')
  .argument('[path]', 'Workspace path', process.cwd())
  .option('-n, --number <count>', 'Number of sessions to show', '10')
  .description('Debug Claude sessions for a path')
  .action(async (targetPath, options) => {
    const resolvedPath = expandHome(targetPath);
    const limit = parseInt(options.number, 10) || 10;
    const sessions = await getClaudeSessions(resolvedPath, limit);
    console.log(`Claude debug`);
    console.log(`cwd: ${resolvedPath}`);
    printSessions('sessions', sessions);
  });

program
  .command('cursor')
  .argument('[path]', 'Workspace path', process.cwd())
  .option('-n, --number <count>', 'Number of sessions to show', '10')
  .description('Debug Cursor sessions for a path')
  .action(async (targetPath, options) => {
    const resolvedPath = expandHome(targetPath);
    const limit = parseInt(options.number, 10) || 10;
    const debug = getCursorDebugInfo(resolvedPath);

    console.log('Cursor debug');
    console.log(`cwd: ${debug.cwd}`);
    console.log(`resolvedCwd: ${debug.resolvedCwd}`);
    console.log(`projectRoot: ${debug.projectRoot ?? 'null'}`);
    console.log(`projectHash: ${debug.projectHash ?? 'null'}`);
    console.log(`chatsDir: ${debug.chatsDir ?? 'null'}`);
    console.log(`dbFiles: ${debug.dbFiles.length}`);
    debug.dbFiles.forEach((file, i) => {
      console.log(`  ${i + 1}. ${file}`);
    });

    if (!debug.projectRoot) {
      return;
    }

    const sessions = await getCursorSessions(resolvedPath, limit);
    printSessions('sessions', sessions);
  });

program.parse(process.argv);

#!/usr/bin/env node

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import App from './ui/app.js';
import path from 'path';
import { createRequire } from 'module';

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

program.parse(process.argv);

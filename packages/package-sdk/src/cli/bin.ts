#!/usr/bin/env node
/**
 * The `nebulahome-package` executable: runs the command, and ends with its exit code.
 */
import { run } from './index.js';

process.exitCode = await run(process.argv.slice(2));

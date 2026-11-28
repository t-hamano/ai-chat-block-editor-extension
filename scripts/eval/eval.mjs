#!/usr/bin/env node

/**
 * Runs the evaluation with promptfoo and adds the run to `history.jsonl`.
 * promptfoo writes the results to a temporary file, which is removed
 * after they are read.
 *
 * The run is recorded only when every case passed. Otherwise, and when
 * promptfoo wrote no results, such as when it was stopped, the command
 * ends with an error.
 *
 * Usage: npm run eval [-- promptfoo's options]
 */

/**
 * External dependencies
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Internal dependencies
 */
import { record } from './record.mjs';

const ROOT = path.resolve( import.meta.dirname, '../..' );

/* eslint-disable no-console -- A command line script reports through the console. */
// npm runs this script, and runs promptfoo the same way `npx` does, without a shell.
const npm = process.env.npm_execpath;
if ( ! npm ) {
	console.error( 'Run the evaluation with `npm run eval`.' );
	process.exit( 1 );
}

const folder = fs.mkdtempSync( path.join( os.tmpdir(), 'blocktune-eval-' ) );
const RESULTS = path.join( folder, 'results.json' );
process.on( 'exit', () => fs.rmSync( folder, { recursive: true, force: true } ) );

const { status, error } = spawnSync(
	process.execPath,
	[
		npm,
		'exec',
		'--yes',
		'--package=promptfoo@0.125.1',
		'--',
		'promptfoo',
		'eval',
		'-c',
		'scripts/eval/promptfooconfig.yaml',
		'-o',
		RESULTS,
		...process.argv.slice( 2 ),
	],
	{ cwd: ROOT, stdio: 'inherit' }
);
if ( error ) {
	throw error;
}

console.log();
if ( ! fs.existsSync( RESULTS ) ) {
	console.error( 'promptfoo wrote no results, so the run is not recorded.' );
	process.exit( status || 1 );
}
try {
	record( RESULTS );
} catch ( recordError ) {
	console.error( recordError.message );
	process.exit( 1 );
}
process.exit( status ?? 1 );

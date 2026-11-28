/**
 * Internal dependencies
 */
import type { AiActivity, AiChatRequest, AiRead, AiReadResult } from '..';

/**
 * The tool the model reads blocks of a long document with.
 */
export const READ_BLOCKS_TOOL = {
	name: 'read_blocks',
	description:
		'Returns the block markup of the blocks with the reference IDs, nested blocks included, as the document is now. Use it to read blocks of a long document that you only know from <outline>, before you edit them.',
	input_schema: {
		type: 'object',
		properties: {
			refs: {
				type: 'array',
				items: { type: 'string' },
				description: 'The reference IDs of the blocks, such as "b12".',
			},
		},
		required: [ 'refs' ],
	},
};

/**
 * The tool the model searches a long document with.
 */
export const FIND_BLOCKS_TOOL = {
	name: 'find_blocks',
	description:
		'Searches the text of the blocks in the document as it is now, ignoring case, and returns the reference ID, name, and leading text of each block that has it. Use it to find the blocks of a long document to read or edit.',
	input_schema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'The text to search for.',
			},
		},
		required: [ 'query' ],
	},
};

/**
 * The tools the model reads the document with. Every provider gets them,
 * with the edit tool.
 */
export const READ_TOOLS = [ READ_BLOCKS_TOOL, FIND_BLOCKS_TOOL ];

/**
 * Tells whether a tool reads the document, so the user sees that the model
 * is reading instead of editing.
 *
 * @param name The tool's name.
 * @return The activity while the tool's call is written.
 */
export function getToolActivity( name: unknown ): AiActivity {
	return READ_TOOLS.some( ( tool ) => tool.name === name ) ? 'reading' : 'editing';
}

/**
 * Reads the request from the input of a read tool call.
 *
 * @param name  The tool's name.
 * @param input The input.
 * @return The request, `null` when the input does not match the tool, or
 *         `undefined` when the tool is not a read tool.
 */
export function toRead( name: unknown, input: unknown ): AiRead | null | undefined {
	const { refs, query } = ( input ?? {} ) as Record< string, unknown >;
	if ( name === READ_BLOCKS_TOOL.name ) {
		return Array.isArray( refs ) &&
			refs.length &&
			refs.every( ( ref ) => typeof ref === 'string' && ref )
			? { tool: 'read_blocks', refs }
			: null;
	}
	if ( name === FIND_BLOCKS_TOOL.name ) {
		return typeof query === 'string' && query.trim()
			? { tool: 'find_blocks', query: query.trim() }
			: null;
	}
	return undefined;
}

/**
 * Runs a read tool call.
 *
 * @param name  The tool's name.
 * @param input The input.
 * @param read  Reads the document, when it is available.
 * @return What the read found, or `null` when the tool is not a read tool.
 */
export function runRead(
	name: unknown,
	input: unknown,
	read: AiChatRequest[ 'read' ]
): AiReadResult | null {
	const request = toRead( name, input );
	if ( request === undefined ) {
		return null;
	}
	if ( request === null ) {
		return {
			status: 'failed',
			reason: `Call ${ READ_BLOCKS_TOOL.name } with "refs" set to a list of reference IDs, or ${ FIND_BLOCKS_TOOL.name } with "query" set to the text to search for.`,
		};
	}
	if ( ! read ) {
		return { status: 'failed', reason: 'The document is not available.' };
	}
	return read( request );
}

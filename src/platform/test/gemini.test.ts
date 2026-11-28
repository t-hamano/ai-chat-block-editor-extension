/**
 * External dependencies
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import type { AiStreamEvent } from '..';
import { EDIT_TOOL } from '../tools';
import {
	GEMINI_EDIT_TOOL,
	GEMINI_READ_TOOLS,
	GEMINI_MODEL,
	buildGeminiBody,
	createGeminiPlatform,
	readGeminiErrorMessage,
	readGeminiStream,
	toGeminiContents,
} from '../gemini';
import { readEvents } from '../transport';
import { streamBody } from './stream-body';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );

function sse( data: Record< string, unknown > ) {
	return `data: ${ JSON.stringify( data ) }\n\n`;
}

function chunk( parts: unknown[], extra: Record< string, unknown > = {} ) {
	return sse( { candidates: [ { content: { role: 'model', parts }, ...extra } ] } );
}

async function read( pieces: string[] ) {
	const events: AiStreamEvent[] = [];
	const done = readGeminiStream( readEvents( streamBody( pieces ) ), ( event ) => {
		events.push( event );
	} );
	return { events, done };
}

const EDIT = {
	action: 'replace' as const,
	markup: '<!-- wp:paragraph -->\n<p>New.</p>\n<!-- /wp:paragraph -->',
};

describe( 'GEMINI_EDIT_TOOL', () => {
	it( 'is the same tool as for Anthropic', () => {
		expect( GEMINI_EDIT_TOOL ).toEqual( {
			name: EDIT_TOOL.name,
			description: EDIT_TOOL.description,
			parameters: EDIT_TOOL.input_schema,
		} );
	} );
} );

describe( 'buildGeminiBody', () => {
	it( 'sends the model, the system prompt, the edit tool, and the contents', () => {
		const contents = toGeminiContents( [ { role: 'user', text: 'Hi' } ] );
		expect( buildGeminiBody( 'Be brief.', contents ) ).toEqual( {
			model: GEMINI_MODEL,
			systemInstruction: { parts: [ { text: 'Be brief.' } ] },
			contents,
			tools: [ { functionDeclarations: [ GEMINI_EDIT_TOOL, ...GEMINI_READ_TOOLS ] } ],
			generationConfig: {
				thinkingConfig: { includeThoughts: true },
			},
		} );
	} );
} );

describe( 'toGeminiContents', () => {
	it( 'tells the model again the reference IDs of the blocks its edits added', () => {
		const sent = JSON.stringify(
			toGeminiContents( [
				{ role: 'user', text: 'Add two blocks' },
				{
					role: 'assistant',
					text: 'Added.',
					edits: [ EDIT, EDIT ],
					editRefs: [ [ 'b7', 'b8' ], [] ],
				},
				{ role: 'user', text: 'Thanks' },
			] )
		);
		expect( sent ).toContain(
			'The edit was applied. The reference IDs of the new blocks are b7, b8.'
		);
		expect( sent.match( /The edit was applied\./g ) ).toHaveLength( 2 );
	} );

	it( 'sends the text, and the edits as function calls that were applied', () => {
		expect(
			toGeminiContents( [
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: 'Hello' },
				{ role: 'user', text: 'Rewrite this' },
				{ role: 'assistant', text: '', edits: [ EDIT ] },
				{ role: 'user', text: 'Thanks' },
			] )
		).toEqual( [
			{ role: 'user', parts: [ { text: 'Hi' } ] },
			{ role: 'model', parts: [ { text: 'Hello' } ] },
			{ role: 'user', parts: [ { text: 'Rewrite this' } ] },
			{ role: 'model', parts: [ { functionCall: { name: 'edit_blocks', args: EDIT } } ] },
			{
				role: 'user',
				parts: [
					{
						functionResponse: {
							name: 'edit_blocks',
							response: { output: 'The edit was applied.' },
						},
					},
					{ text: 'Thanks' },
				],
			},
		] );
	} );
} );

describe( 'readGeminiErrorMessage', () => {
	it( 'reads the message of an error, alone or in an array', async () => {
		const error = { error: { code: 400, message: 'API key not valid.' } };
		expect( await readGeminiErrorMessage( Response.json( error, { status: 400 } ) ) ).toBe(
			'API key not valid.'
		);
		expect( await readGeminiErrorMessage( Response.json( [ error ], { status: 400 } ) ) ).toBe(
			'API key not valid.'
		);
	} );

	it( 'reads the message of a WordPress error', async () => {
		const error = { code: 'x', message: 'No API key is set for this provider.' };
		expect( await readGeminiErrorMessage( Response.json( error, { status: 400 } ) ) ).toBe(
			'No API key is set for this provider.'
		);
	} );
} );

describe( 'readGeminiStream', () => {
	it( 'streams the text and the thinking, and joins the parts', async () => {
		const { events, done } = await read( [
			chunk( [ { text: 'Planning', thought: true } ] ),
			chunk( [ { text: '…', thought: true } ] ),
			chunk( [ { text: 'Hel' } ] ),
			chunk( [ { text: 'lo', thoughtSignature: 'sig' } ] ),
			chunk( [ { text: '' } ], { finishReason: 'STOP' } ),
			sse( {
				usageMetadata: {
					promptTokenCount: 110,
					cachedContentTokenCount: 100,
					candidatesTokenCount: 30,
					thoughtsTokenCount: 12,
				},
			} ),
		] );

		const answer = await done;

		expect( events ).toEqual( [
			{ type: 'activity', activity: 'thinking' },
			{ type: 'text', text: 'Hel' },
			{ type: 'text', text: 'lo' },
			{ type: 'usage', usage: { inputTokens: 110, cachedInputTokens: 100, outputTokens: 42 } },
		] );
		expect( answer ).toEqual( {
			parts: [
				{ text: 'Planning…', thought: true },
				{ text: 'Hello', thoughtSignature: 'sig' },
				{ text: '' },
			],
			calls: [],
		} );
	} );

	it( 'collects the function calls with their signatures', async () => {
		const call = { functionCall: { name: 'edit_blocks', args: EDIT }, thoughtSignature: 'sig' };
		const { events, done } = await read( [ chunk( [ call ], { finishReason: 'STOP' } ) ] );

		expect( await done ).toEqual( { parts: [ call ], calls: [ call ] } );
		expect( events ).toEqual( [ { type: 'activity', activity: 'editing' } ] );
	} );

	it( 'rejects with the message of an error', async () => {
		const { done } = await read( [ sse( { error: { code: 503, message: 'Overloaded' } } ) ] );

		await expect( done ).rejects.toThrow( 'Overloaded' );
	} );

	it( 'rejects when the prompt is blocked', async () => {
		const { done } = await read( [ sse( { promptFeedback: { blockReason: 'SAFETY' } } ) ] );

		await expect( done ).rejects.toThrow( 'The model declined to answer.' );
	} );

	it( 'rejects when the answer is stopped for safety', async () => {
		const { done } = await read( [ chunk( [ { text: 'Part' } ], { finishReason: 'SAFETY' } ) ] );

		await expect( done ).rejects.toThrow( 'The model declined to answer.' );
	} );

	it( 'rejects when the stream ends before the answer is finished', async () => {
		const { events, done } = await read( [ chunk( [ { text: 'Part' } ] ) ] );

		await expect( done ).rejects.toThrow( 'The connection was lost' );
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );

	it( 'rejects when the answer is cut off', async () => {
		const { events, done } = await read( [
			chunk( [ { text: 'Part' } ], { finishReason: 'MAX_TOKENS' } ),
		] );

		await expect( done ).rejects.toThrow( 'The answer was cut off because it was too long.' );
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );
} );

describe( 'createGeminiPlatform', () => {
	const toolCall = ( args: unknown, name = 'edit_blocks' ) => [
		chunk( [ { functionCall: { id: 'call_1', name, args }, thoughtSignature: 'sig' } ], {
			finishReason: 'STOP',
		} ),
	];
	const text = [ chunk( [ { text: 'Done.' } ], { finishReason: 'STOP' } ) ];

	function respond( ...answers: string[][] ) {
		const requests: any[] = [];
		vi.mocked( apiFetch ).mockReset();
		answers.forEach( ( pieces ) => {
			vi.mocked( apiFetch ).mockImplementationOnce( async ( options: any ) => {
				requests.push( structuredClone( options.data ) );
				return new Response( streamBody( pieces ) );
			} );
		} );
		return requests;
	}

	it( 'ends the answer when the edit after the text was applied as it is', async () => {
		const requests = respond( [ chunk( [ { text: 'I shortened it.' } ] ), ...toolCall( EDIT ) ] );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await createGeminiPlatform( () => 1 ).chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( requests ).toHaveLength( 1 );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
	} );

	it( 'applies the edit, and sends the result back for the model to go on', async () => {
		const requests = respond( toolCall( EDIT ), text );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const, refs: [ 'b3' ] } : undefined
		);

		await createGeminiPlatform( () => 1 ).chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( requests[ 0 ] ).toMatchObject( { provider: 'google', post_id: 1, stream: true } );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
		expect( requests[ 1 ].body.contents ).toEqual( [
			{ role: 'user', parts: [ { text: 'Rewrite this' } ] },
			{
				role: 'model',
				parts: [
					{
						functionCall: { id: 'call_1', name: 'edit_blocks', args: EDIT },
						thoughtSignature: 'sig',
					},
				],
			},
			{
				role: 'user',
				parts: [
					{
						functionResponse: {
							id: 'call_1',
							name: 'edit_blocks',
							response: {
								output: 'The edit was applied. The reference IDs of the new blocks are b3.',
							},
						},
					},
				],
			},
		] );
	} );

	it( 'gives up after the model fails to fix its edit three times', async () => {
		const bad = toolCall( { action: 'replace_block' } );
		const requests = respond( bad, bad, bad, bad, text );
		const onEvent = vi.fn();

		await expect(
			createGeminiPlatform( () => 1 ).chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Rewrite this' } ],
				onEvent,
				signal: new AbortController().signal,
			} )
		).rejects.toThrow( 'The edit could not be made.' );

		expect( requests ).toHaveLength( 4 );
		expect( requests[ 1 ].body.contents[ 2 ].parts[ 0 ].functionResponse.response.error ).toContain(
			'edit_blocks'
		);
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );

	it( 'rejects with the message of an error response', async () => {
		vi.mocked( apiFetch ).mockReset();
		vi.mocked( apiFetch ).mockRejectedValueOnce(
			Response.json( [ { error: { message: 'API key not valid.' } } ], { status: 400 } )
		);

		await expect(
			createGeminiPlatform( () => 1 ).chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Hi' } ],
				onEvent: vi.fn(),
				signal: new AbortController().signal,
			} )
		).rejects.toThrow( 'API key not valid.' );
	} );
} );

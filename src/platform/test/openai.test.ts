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
	OPENAI_EDIT_TOOL,
	OPENAI_READ_TOOLS,
	OPENAI_EFFORT,
	OPENAI_MODEL,
	buildOpenAiBody,
	createOpenAiPlatform,
	readOpenAiStream,
	toOpenAiEvents,
	toOpenAiInput,
} from '../openai';
import { readEvents } from '../transport';
import { streamBody } from './stream-body';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );

function sse( data: { type: string; [ key: string ]: unknown } ) {
	return `event: ${ data.type }\ndata: ${ JSON.stringify( data ) }\n\n`;
}

async function read( pieces: string[] ) {
	const events: AiStreamEvent[] = [];
	const done = readOpenAiStream( readEvents( streamBody( pieces ) ), ( event ) => {
		events.push( event );
	} );
	return { events, done };
}

const EDIT = {
	action: 'replace' as const,
	markup: '<!-- wp:paragraph -->\n<p>New.</p>\n<!-- /wp:paragraph -->',
};

const completed = ( usage = {} ) =>
	sse( { type: 'response.completed', response: { status: 'completed', usage } } );

describe( 'OPENAI_EDIT_TOOL', () => {
	it( 'is the same tool as for Anthropic', () => {
		expect( OPENAI_EDIT_TOOL ).toMatchObject( {
			type: 'function',
			name: EDIT_TOOL.name,
			description: EDIT_TOOL.description,
			parameters: EDIT_TOOL.input_schema,
		} );
	} );
} );

describe( 'buildOpenAiBody', () => {
	it( 'sends the system prompt, the edit tool, and the input, without storing them', () => {
		const input = toOpenAiInput( [ { role: 'user', text: 'Hi' } ] );
		expect( buildOpenAiBody( 'Be brief.', input ) ).toEqual( {
			model: OPENAI_MODEL,
			instructions: 'Be brief.',
			tools: [ OPENAI_EDIT_TOOL, ...OPENAI_READ_TOOLS ],
			input,
			store: false,
			include: [ 'reasoning.encrypted_content' ],
			reasoning: { effort: OPENAI_EFFORT },
		} );
	} );

	it( 'leaves the effort out for other models', () => {
		const body = buildOpenAiBody( 'Be brief.', [], 'gpt-6-sol' );
		expect( body ).not.toHaveProperty( 'reasoning' );
	} );
} );

describe( 'toOpenAiInput', () => {
	it( 'tells the model again the reference IDs of the blocks its edits added', () => {
		const sent = JSON.stringify(
			toOpenAiInput( [
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
			toOpenAiInput( [
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: 'Hello' },
				{ role: 'user', text: 'Rewrite this' },
				{ role: 'assistant', text: 'Rewrote it.', edits: [ EDIT ] },
				{ role: 'user', text: 'Thanks' },
			] )
		).toEqual( [
			{ role: 'user', content: 'Hi' },
			{ role: 'assistant', content: 'Hello' },
			{ role: 'user', content: 'Rewrite this' },
			{ role: 'assistant', content: 'Rewrote it.' },
			{
				type: 'function_call',
				call_id: 'call_edit_3_0',
				name: 'edit_blocks',
				arguments: JSON.stringify( EDIT ),
			},
			{ type: 'function_call_output', call_id: 'call_edit_3_0', output: expect.any( String ) },
			{ role: 'user', content: 'Thanks' },
		] );
	} );
} );

async function* fromArray< T >( items: T[] ) {
	yield* items;
}

describe( 'toOpenAiEvents', () => {
	it( 'reads a whole answer as if it was streamed', async () => {
		const output = [
			{ type: 'message', content: [ { type: 'output_text', text: 'Done.' } ] },
			{ type: 'function_call', call_id: 'call_1', name: 'edit_blocks', arguments: '{}' },
		];
		const events: AiStreamEvent[] = [];
		const answer = await readOpenAiStream(
			fromArray(
				toOpenAiEvents( {
					status: 'completed',
					output,
					usage: { input_tokens: 10, output_tokens: 5 },
				} )
			),
			( event ) => {
				events.push( event );
			}
		);

		expect( answer.output ).toEqual( output );
		expect( answer.calls ).toEqual( [ output[ 1 ] ] );
		expect( events ).toEqual( [
			{ type: 'text', text: 'Done.' },
			{ type: 'activity', activity: 'editing' },
			{
				type: 'usage',
				usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
			},
		] );
	} );

	it( 'rejects an answer that was cut off', async () => {
		const events = toOpenAiEvents( {
			status: 'incomplete',
			incomplete_details: { reason: 'max_output_tokens' },
			output: [],
		} );

		await expect( readOpenAiStream( fromArray( events ), () => {} ) ).rejects.toThrow( 'cut off' );
	} );
} );

describe( 'readOpenAiStream', () => {
	it( 'streams the reasoning, the text, and the usage', async () => {
		const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' };
		const message = {
			type: 'message',
			id: 'msg_1',
			role: 'assistant',
			content: [ { type: 'output_text', text: 'Hello' } ],
		};
		const { events, done } = await read( [
			sse( { type: 'response.created', response: { status: 'in_progress' } } ),
			sse( { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning' } } ),
			sse( { type: 'response.output_item.done', output_index: 0, item: reasoning } ),
			sse( { type: 'response.output_item.added', output_index: 1, item: { type: 'message' } } ),
			sse( { type: 'response.output_text.delta', output_index: 1, delta: 'Hel' } ),
			sse( { type: 'response.output_text.delta', output_index: 1, delta: 'lo' } ),
			sse( { type: 'response.output_item.done', output_index: 1, item: message } ),
			completed( {
				input_tokens: 110,
				input_tokens_details: { cached_tokens: 100 },
				output_tokens: 42,
			} ),
		] );

		const answer = await done;

		expect( events ).toEqual( [
			{ type: 'activity', activity: 'thinking' },
			{ type: 'text', text: 'Hel' },
			{ type: 'text', text: 'lo' },
			{ type: 'usage', usage: { inputTokens: 110, cachedInputTokens: 100, outputTokens: 42 } },
		] );
		expect( answer ).toEqual( { output: [ reasoning, message ], calls: [] } );
	} );

	it( 'collects the function calls', async () => {
		const call = {
			type: 'function_call',
			id: 'fc_1',
			call_id: 'call_1',
			name: 'edit_blocks',
			arguments: JSON.stringify( EDIT ),
		};
		const { events, done } = await read( [
			sse( {
				type: 'response.output_item.added',
				output_index: 0,
				item: { type: 'function_call' },
			} ),
			sse( { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{' } ),
			sse( { type: 'response.output_item.done', output_index: 0, item: call } ),
			completed(),
		] );

		expect( await done ).toEqual( { output: [ call ], calls: [ call ] } );
		expect( events ).toEqual( [
			{ type: 'activity', activity: 'editing' },
			{ type: 'usage', usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } },
		] );
	} );

	it( 'rejects with the message of an error event', async () => {
		const { done } = await read( [
			sse( { type: 'error', code: 'server_error', message: 'Overloaded' } ),
		] );

		await expect( done ).rejects.toThrow( 'Overloaded' );
	} );

	it( 'rejects with the message of a failed response', async () => {
		const { done } = await read( [
			sse( {
				type: 'response.failed',
				response: { status: 'failed', error: { message: 'Something broke' } },
			} ),
		] );

		await expect( done ).rejects.toThrow( 'Something broke' );
	} );

	it( 'rejects when the model declines to answer', async () => {
		const { done } = await read( [
			sse( { type: 'response.refusal.done', output_index: 0, refusal: 'No.' } ),
		] );

		await expect( done ).rejects.toThrow( 'The model declined to answer.' );
	} );

	it( 'rejects when the stream ends before the answer is finished', async () => {
		const { events, done } = await read( [
			sse( { type: 'response.output_text.delta', output_index: 0, delta: 'Part' } ),
		] );

		await expect( done ).rejects.toThrow( 'The connection was lost' );
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );

	it( 'rejects when the answer is cut off', async () => {
		const { events, done } = await read( [
			sse( { type: 'response.output_text.delta', output_index: 0, delta: 'Part' } ),
			sse( {
				type: 'response.incomplete',
				response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
			} ),
		] );

		await expect( done ).rejects.toThrow( 'The answer was cut off because it was too long.' );
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );
} );

describe( 'createOpenAiPlatform', () => {
	const toolCall = ( args: string ) => [
		sse( {
			type: 'response.output_item.done',
			output_index: 0,
			item: { type: 'function_call', call_id: 'call_1', name: 'edit_blocks', arguments: args },
		} ),
		completed(),
	];
	const text = [ sse( { type: 'response.output_text.delta', delta: 'Done.' } ), completed() ];

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
		const requests = respond( [
			sse( { type: 'response.output_text.delta', delta: 'I shortened it.' } ),
			...toolCall( JSON.stringify( EDIT ) ),
		] );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await createOpenAiPlatform( () => 1 ).chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( requests ).toHaveLength( 1 );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
	} );

	it( 'applies the edit, and sends the result back for the model to go on', async () => {
		const requests = respond( toolCall( JSON.stringify( EDIT ) ), text );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await createOpenAiPlatform( () => 1 ).chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( requests[ 0 ] ).toMatchObject( { provider: 'openai', post_id: 1, stream: true } );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
		expect( requests[ 1 ].body.input ).toEqual( [
			{ role: 'user', content: 'Rewrite this' },
			{
				type: 'function_call',
				call_id: 'call_1',
				name: 'edit_blocks',
				arguments: JSON.stringify( EDIT ),
			},
			{ type: 'function_call_output', call_id: 'call_1', output: 'The edit was applied.' },
		] );
	} );

	it( 'gives up after the model fails to fix its edit three times', async () => {
		const bad = toolCall( '{"action":' );
		const requests = respond( bad, bad, bad, bad, text );
		const onEvent = vi.fn();

		await expect(
			createOpenAiPlatform( () => 1 ).chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Rewrite this' } ],
				onEvent,
				signal: new AbortController().signal,
			} )
		).rejects.toThrow( 'The edit could not be made.' );

		expect( requests ).toHaveLength( 4 );
		expect( requests[ 1 ].body.input[ 2 ].output ).toContain( 'INVALID_JSON' );
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );
} );

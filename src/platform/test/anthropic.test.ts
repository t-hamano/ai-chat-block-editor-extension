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
import {
	ANTHROPIC_EFFORT,
	ANTHROPIC_MODEL,
	buildAnthropicBody,
	createAnthropicPlatform,
	readAnthropicStream,
	toAnthropicEvents,
	toAnthropicMessages,
} from '../anthropic';
import { READ_TOOLS } from '../read-tools';
import { EDIT_TOOL } from '../tools';
import { readEvents } from '../transport';
import { streamBody } from './stream-body';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );

function sse( event: string, data: object ) {
	return `event: ${ event }\ndata: ${ JSON.stringify( data ) }\n\n`;
}

async function read( pieces: string[] ) {
	const events: AiStreamEvent[] = [];
	const done = readAnthropicStream( readEvents( streamBody( pieces ) ), ( event ) => {
		events.push( event );
	} );
	return { events, done };
}

const EDIT = {
	action: 'replace' as const,
	markup: '<!-- wp:paragraph -->\n<p>New.</p>\n<!-- /wp:paragraph -->',
};

describe( 'buildAnthropicBody', () => {
	it( 'sends the system prompt, the edit tool, and the messages', () => {
		const messages = toAnthropicMessages( [ { role: 'user', text: 'Hi' } ] );
		expect( buildAnthropicBody( 'Be brief.', messages ) ).toEqual( {
			model: ANTHROPIC_MODEL,
			cache_control: { type: 'ephemeral' },
			system: [ { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } } ],
			tools: [ EDIT_TOOL, ...READ_TOOLS ],
			messages,
			output_config: { effort: ANTHROPIC_EFFORT },
		} );
	} );

	it( 'leaves the effort out for other models', () => {
		const body = buildAnthropicBody( 'Be brief.', [], 'claude-sonnet-5' );
		expect( body ).not.toHaveProperty( 'output_config' );
	} );
} );

describe( 'toAnthropicMessages', () => {
	it( 'tells the model again the reference IDs of the blocks its edits added', () => {
		const sent = JSON.stringify(
			toAnthropicMessages( [
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

	it( 'sends the text, and the edits as tool calls that were applied', () => {
		expect(
			toAnthropicMessages( [
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: 'Hello' },
				{ role: 'user', text: 'Rewrite this' },
				{ role: 'assistant', text: 'Rewrote it.', edits: [ EDIT ] },
				{ role: 'user', text: 'Thanks' },
			] )
		).toEqual( [
			{ role: 'user', content: [ { type: 'text', text: 'Hi' } ] },
			{ role: 'assistant', content: [ { type: 'text', text: 'Hello' } ] },
			{ role: 'user', content: [ { type: 'text', text: 'Rewrite this' } ] },
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Rewrote it.' },
					{ type: 'tool_use', id: 'toolu_edit_3_0', name: 'edit_blocks', input: EDIT },
				],
			},
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_edit_3_0', content: expect.any( String ) },
					{ type: 'text', text: 'Thanks' },
				],
			},
		] );
	} );
} );

async function* fromArray< T >( items: T[] ) {
	yield* items;
}

describe( 'toAnthropicEvents', () => {
	it( 'reads a whole answer as if it was streamed', async () => {
		const content = [
			{ type: 'thinking', thinking: 'Plan', signature: 'sig' },
			{ type: 'text', text: 'Done.' },
			{ type: 'tool_use', id: 'toolu_1', name: 'edit_blocks', input: EDIT },
		];
		const events: AiStreamEvent[] = [];
		const answer = await readAnthropicStream(
			fromArray(
				toAnthropicEvents( {
					content,
					stop_reason: 'tool_use',
					usage: { input_tokens: 10, output_tokens: 5 },
				} )
			),
			( event ) => {
				events.push( event );
			}
		);

		expect( answer.content ).toEqual( content );
		expect( answer.stopReason ).toBe( 'tool_use' );
		expect( events ).toEqual( [
			{ type: 'activity', activity: 'thinking' },
			{ type: 'text', text: 'Done.' },
			{ type: 'activity', activity: 'editing' },
			{
				type: 'usage',
				usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
			},
		] );
	} );
} );

describe( 'readAnthropicStream', () => {
	it( 'streams the thinking, the text, and the usage', async () => {
		const { events, done } = await read( [
			sse( 'message_start', {
				message: {
					usage: {
						input_tokens: 10,
						cache_read_input_tokens: 100,
						cache_creation_input_tokens: 5,
						output_tokens: 1,
					},
				},
			} ),
			sse( 'content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } } ),
			sse( 'content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '' } } ),
			sse( 'content_block_stop', { index: 0 } ),
			sse( 'ping', {} ),
			sse( 'content_block_start', { index: 1, content_block: { type: 'text', text: '' } } ),
			sse( 'content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Hel' } } ),
			sse( 'content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'lo' } } ),
			sse( 'content_block_stop', { index: 1 } ),
			sse( 'message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } } ),
			sse( 'message_stop', {} ),
		] );

		await done;

		expect( events ).toEqual( [
			{ type: 'activity', activity: 'thinking' },
			{ type: 'text', text: 'Hel' },
			{ type: 'text', text: 'lo' },
			{ type: 'usage', usage: { inputTokens: 115, cachedInputTokens: 100, outputTokens: 42 } },
		] );
	} );

	it( 'collects the content to send back, with the thinking and the tool input', async () => {
		const { events, done } = await read( [
			sse( 'content_block_start', {
				index: 0,
				content_block: { type: 'thinking', thinking: '', signature: '' },
			} ),
			sse( 'content_block_delta', {
				index: 0,
				delta: { type: 'signature_delta', signature: 'sig' },
			} ),
			sse( 'content_block_stop', { index: 0 } ),
			sse( 'content_block_start', {
				index: 1,
				content_block: { type: 'tool_use', id: 'toolu_1', name: 'edit_blocks', input: {} },
			} ),
			sse( 'content_block_delta', {
				index: 1,
				delta: { type: 'input_json_delta', partial_json: '{"action":"replace",' },
			} ),
			sse( 'content_block_delta', {
				index: 1,
				delta: { type: 'input_json_delta', partial_json: '"markup":"<p>x</p>"}' },
			} ),
			sse( 'content_block_stop', { index: 1 } ),
			sse( 'content_block_start', {
				index: 2,
				content_block: { type: 'tool_use', id: 'toolu_2', name: 'edit_blocks', input: {} },
			} ),
			sse( 'content_block_delta', {
				index: 2,
				delta: { type: 'input_json_delta', partial_json: '{"action":' },
			} ),
			sse( 'content_block_stop', { index: 2 } ),
			sse( 'message_delta', { delta: { stop_reason: 'tool_use' }, usage: {} } ),
		] );

		const answer = await done;

		expect( events ).toEqual( [
			{ type: 'activity', activity: 'thinking' },
			{ type: 'activity', activity: 'editing' },
			{ type: 'activity', activity: 'editing' },
		] );
		expect( answer ).toEqual( {
			content: [
				{ type: 'thinking', thinking: '', signature: 'sig' },
				{
					type: 'tool_use',
					id: 'toolu_1',
					name: 'edit_blocks',
					input: { action: 'replace', markup: '<p>x</p>' },
				},
				{ type: 'tool_use', id: 'toolu_2', name: 'edit_blocks', input: {} },
			],
			stopReason: 'tool_use',
			invalidInputs: new Map( [ [ 'toolu_2', '{"action":' ] ] ),
		} );
	} );

	it( 'rejects with the message of an error event', async () => {
		const { done } = await read( [
			sse( 'message_start', { message: { usage: { input_tokens: 1, output_tokens: 0 } } } ),
			sse( 'error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } ),
		] );

		await expect( done ).rejects.toThrow( 'Overloaded' );
	} );

	it( 'rejects when the model declines to answer', async () => {
		const { done } = await read( [
			sse( 'message_delta', { delta: { stop_reason: 'refusal' }, usage: {} } ),
		] );

		await expect( done ).rejects.toThrow();
	} );

	it( 'rejects when the stream ends before the answer is finished', async () => {
		const { events, done } = await read( [
			sse( 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Part' } } ),
		] );

		await expect( done ).rejects.toThrow( 'The connection was lost' );
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );

	it( 'rejects when the answer is cut off', async () => {
		const { events, done } = await read( [
			sse( 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Part' } } ),
			sse( 'message_delta', { delta: { stop_reason: 'max_tokens' }, usage: {} } ),
		] );

		await expect( done ).rejects.toThrow();
		expect( events ).toEqual( [ { type: 'text', text: 'Part' } ] );
	} );
} );

describe( 'createAnthropicPlatform', () => {
	const toolCall = ( input: string, name = 'edit_blocks' ) => [
		sse( 'content_block_start', {
			index: 0,
			content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} },
		} ),
		sse( 'content_block_delta', {
			index: 0,
			delta: { type: 'input_json_delta', partial_json: input },
		} ),
		sse( 'content_block_stop', { index: 0 } ),
		sse( 'message_delta', { delta: { stop_reason: 'tool_use' }, usage: {} } ),
	];
	const text = [
		sse( 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } } ),
		sse( 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Done.' } } ),
		sse( 'message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} } ),
	];

	function respond( ...answers: string[][] ) {
		const bodies: any[] = [];
		vi.mocked( apiFetch ).mockReset();
		answers.forEach( ( pieces ) => {
			vi.mocked( apiFetch ).mockImplementationOnce( async ( options: any ) => {
				bodies.push( structuredClone( options.data.body ) );
				return new Response( streamBody( pieces ) );
			} );
		} );
		return bodies;
	}

	it( 'applies the edit, and sends the result back for the model to go on', async () => {
		const bodies = respond( toolCall( JSON.stringify( EDIT ) ), text );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await createAnthropicPlatform().chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
		expect( bodies[ 1 ].messages ).toEqual( [
			{ role: 'user', content: [ { type: 'text', text: 'Rewrite this' } ] },
			{
				role: 'assistant',
				content: [ { type: 'tool_use', id: 'toolu_1', name: 'edit_blocks', input: EDIT } ],
			},
			{
				role: 'user',
				content: [
					{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The edit was applied.' },
				],
			},
		] );
	} );

	const textAndToolCall = ( said: string, input: string ) => [
		sse( 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } } ),
		sse( 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: said } } ),
		sse( 'content_block_stop', { index: 0 } ),
		...toolCall( input ).map( ( piece ) => piece.replace( '"index":0', '"index":1' ) ),
	];

	it( 'ends the answer when every edit after the text was applied as it is', async () => {
		const bodies = respond( textAndToolCall( 'I shortened it.', JSON.stringify( EDIT ) ) );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await createAnthropicPlatform().chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( bodies ).toHaveLength( 1 );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'text', text: 'I shortened it.' } );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
		expect( onEvent ).not.toHaveBeenCalledWith(
			expect.objectContaining( { type: 'discard_text' } )
		);
	} );

	it.each( [
		[ 'failed', { status: 'failed' as const, reason: 'Invalid markup.' } ],
		[ 'fixed', { status: 'applied' as const, autoFix: 'The class was fixed.' } ],
		[ 'dropped', { status: 'dropped' as const } ],
	] )(
		'takes back the text, and sends the result back, when an edit was %s',
		async ( _, result ) => {
			const bodies = respond( textAndToolCall( 'I shortened it.', JSON.stringify( EDIT ) ), text );
			const onEvent = vi.fn( ( event: AiStreamEvent ) =>
				event.type === 'edit' ? result : undefined
			);

			await createAnthropicPlatform().chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Rewrite this' } ],
				onEvent,
				signal: new AbortController().signal,
			} );

			expect( bodies ).toHaveLength( 2 );
			expect( onEvent ).toHaveBeenCalledWith( { type: 'discard_text', text: 'I shortened it.' } );
			expect( onEvent ).toHaveBeenLastCalledWith( { type: 'text', text: 'Done.' } );
		}
	);

	it( 'reads the document for the model, and sends what it found back', async () => {
		const bodies = respond( toolCall( '{"refs":["b2"]}', 'read_blocks' ), text );
		const onEvent = vi.fn();
		const readBlocks = vi.fn( () => ( { status: 'done' as const, content: '<p>Two</p>' } ) );

		await createAnthropicPlatform().chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite b2' } ],
			onEvent,
			read: readBlocks,
			signal: new AbortController().signal,
		} );

		expect( readBlocks ).toHaveBeenCalledWith( { tool: 'read_blocks', refs: [ 'b2' ] } );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'activity', activity: 'reading' } );
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
		expect( bodies[ 1 ].messages[ 2 ] ).toEqual( {
			role: 'user',
			content: [ { type: 'tool_result', tool_use_id: 'toolu_1', content: '<p>Two</p>' } ],
		} );
	} );

	it( 'gives up after the model fails to fix its edit three times', async () => {
		const bad = toolCall( '{"action":"replace"}' );
		const bodies = respond( bad, bad, bad, bad, text );
		const onEvent = vi.fn();

		await expect(
			createAnthropicPlatform().chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Rewrite this' } ],
				onEvent,
				signal: new AbortController().signal,
			} )
		).rejects.toThrow( 'The edit could not be made.' );

		expect( bodies ).toHaveLength( 4 );
		expect( bodies[ 1 ].messages[ 2 ].content[ 0 ] ).toMatchObject( { is_error: true } );
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );

	it( 'stops after ten requests when the model keeps calling tools', async () => {
		const readCall = toolCall( '{"refs":["b2"]}', 'read_blocks' );
		const bodies = respond( ...Array.from( { length: 11 }, () => readCall ), text );

		await expect(
			createAnthropicPlatform().chat( {
				system: 'System',
				messages: [ { role: 'user', text: 'Rewrite b2' } ],
				onEvent: vi.fn(),
				read: () => ( { status: 'done' as const, content: '<p>Two</p>' } ),
				signal: new AbortController().signal,
			} )
		).rejects.toThrow( 'took too many steps' );

		expect( bodies ).toHaveLength( 10 );
	} );

	it( 'reads the edits by reference ID, and tells the model the IDs of new blocks', async () => {
		const edit = { action: 'replace_block', ref: 'b2', markup: EDIT.markup };
		const bodies = respond(
			toolCall( JSON.stringify( edit ) ),
			toolCall( '{"action":"delete_block","ref":"b3"}' ),
			text
		);
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const, refs: [ 'b7' ] } : undefined
		);

		await createAnthropicPlatform().chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit } );
		expect( onEvent ).toHaveBeenCalledWith( {
			type: 'edit',
			edit: { action: 'delete_block', ref: 'b3', markup: '' },
		} );
		expect( bodies[ 1 ].messages[ 2 ].content[ 0 ].content ).toBe(
			'The edit was applied. The reference IDs of the new blocks are b7.'
		);
	} );

	it( 'fails an edit by reference ID without the ID', async () => {
		const bodies = respond( toolCall( '{"action":"replace_block","markup":"x"}' ), text );
		const onEvent = vi.fn();

		await createAnthropicPlatform().chat( {
			system: 'System',
			messages: [ { role: 'user', text: 'Rewrite this' } ],
			onEvent,
			signal: new AbortController().signal,
		} );

		expect( bodies[ 1 ].messages[ 2 ].content[ 0 ] ).toMatchObject( { is_error: true } );
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );
} );

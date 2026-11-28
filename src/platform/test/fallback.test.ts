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
	FALLBACK_EDIT_TOOL,
	FALLBACK_READ_TOOLS,
	createFallbackPlatform,
	readFallbackAnswer,
	toFallbackMessages,
	type FallbackAnswer,
	type FallbackPart,
} from '../fallback';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );

const EDIT = {
	action: 'replace' as const,
	markup: '<!-- wp:paragraph -->\n<p>New.</p>\n<!-- /wp:paragraph -->',
};

const answer = ( parts: FallbackPart[], finishReason = 'stop' ): FallbackAnswer => ( {
	message: { role: 'model', parts },
	finishReason,
	usage: { inputTokens: 10, outputTokens: 2 },
	provider: 'test',
	model: 'test-model',
} );

const toolCall = ( args: unknown, name = EDIT_TOOL.name ) =>
	answer( [ { channel: 'content', functionCall: { id: 'call_1', name, args } } ], 'tool_calls' );

const text = answer( [ { channel: 'content', text: 'Done.' } ] );

function respond( ...answers: FallbackAnswer[] ) {
	const requests: any[] = [];
	vi.mocked( apiFetch ).mockReset();
	answers.forEach( ( body ) => {
		vi.mocked( apiFetch ).mockImplementationOnce( async ( options: any ) => {
			requests.push( { path: options.path, ...structuredClone( options.data ) } );
			return body;
		} );
	} );
	return requests;
}

function chat( onEvent: ( event: AiStreamEvent ) => any = () => undefined ) {
	return createFallbackPlatform( [ [ 'anthropic', 'claude-opus-5-5' ] ] ).chat( {
		system: 'System',
		messages: [ { role: 'user', text: 'Rewrite this' } ],
		onEvent,
		signal: new AbortController().signal,
	} );
}

describe( 'FALLBACK_EDIT_TOOL', () => {
	it( 'is the same tool as for Anthropic', () => {
		expect( FALLBACK_EDIT_TOOL ).toEqual( {
			name: EDIT_TOOL.name,
			description: EDIT_TOOL.description,
			parameters: EDIT_TOOL.input_schema,
		} );
	} );
} );

describe( 'toFallbackMessages', () => {
	it( 'tells the model again the reference IDs of the blocks its edits added', () => {
		const sent = JSON.stringify(
			toFallbackMessages( [
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
			toFallbackMessages( [
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: 'Hello' },
				{ role: 'user', text: 'Rewrite this' },
				{ role: 'assistant', text: 'Done.', edits: [ EDIT ] },
				{ role: 'user', text: 'Thanks' },
			] )
		).toEqual( [
			{ role: 'user', parts: [ { text: 'Hi' } ] },
			{ role: 'model', parts: [ { text: 'Hello' } ] },
			{ role: 'user', parts: [ { text: 'Rewrite this' } ] },
			{
				role: 'model',
				parts: [
					{ text: 'Done.' },
					{ functionCall: { id: 'call_edit_3_0', name: 'edit_blocks', args: EDIT } },
				],
			},
			{
				role: 'user',
				parts: [
					{
						functionResponse: {
							id: 'call_edit_3_0',
							name: 'edit_blocks',
							response: 'The edit was applied.',
						},
					},
					{ text: 'Thanks' },
				],
			},
		] );
	} );

	it( 'leaves out an answer without text or edits', () => {
		expect(
			toFallbackMessages( [
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: '' },
				{ role: 'user', text: 'Hello?' },
			] )
		).toEqual( [ { role: 'user', parts: [ { text: 'Hi' }, { text: 'Hello?' } ] } ] );
	} );
} );

describe( 'readFallbackAnswer', () => {
	it( 'reports the usage and the text, without the reasoning', () => {
		const events: AiStreamEvent[] = [];
		const calls = readFallbackAnswer(
			answer( [
				{ channel: 'thought', text: 'Let me think.' },
				{ channel: 'content', text: 'Hello' },
				{ channel: 'content', text: ' there.' },
			] ),
			( event ) => {
				events.push( event );
			}
		);

		expect( calls ).toEqual( [] );
		expect( events ).toEqual( [
			{ type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
			{ type: 'text', text: 'Hello there.' },
		] );
	} );

	it( 'returns the function calls', () => {
		const calls = readFallbackAnswer( toolCall( EDIT ), () => undefined );
		expect( calls ).toEqual( [
			{ channel: 'content', functionCall: { id: 'call_1', name: 'edit_blocks', args: EDIT } },
		] );
	} );

	it.each( [
		[ 'length', 'The answer was cut off because it was too long.' ],
		[ 'content_filter', 'The model declined to answer.' ],
		[ 'error', 'The answer could not be loaded.' ],
	] )( 'throws when the answer ended with %s', ( reason, message ) => {
		const onEvent = vi.fn();
		expect( () =>
			readFallbackAnswer( { ...toolCall( EDIT ), finishReason: reason }, onEvent )
		).toThrow( message );
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );

	it( 'throws when the answer has no message', () => {
		expect( () => readFallbackAnswer( {} as FallbackAnswer, () => undefined ) ).toThrow(
			'The answer could not be read.'
		);
	} );
} );

describe( 'createFallbackPlatform', () => {
	it( 'sends the conversation, the tool, and the preferred models', async () => {
		const requests = respond( text );
		const onEvent = vi.fn();

		await chat( onEvent );

		expect( requests[ 0 ] ).toEqual( {
			path: '/blocktune/v1/fallback',
			system: 'System',
			messages: [ { role: 'user', parts: [ { text: 'Rewrite this' } ] } ],
			tools: [ FALLBACK_EDIT_TOOL, ...FALLBACK_READ_TOOLS ],
			models: [ [ 'anthropic', 'claude-opus-5-5' ] ],
		} );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'text', text: 'Done.' } );
	} );

	it( 'ends the answer when the edit after the text was applied as it is', async () => {
		const requests = respond(
			answer(
				[
					{ channel: 'content', text: 'I shortened it.' },
					{ channel: 'content', functionCall: { id: 'call_1', name: EDIT_TOOL.name, args: EDIT } },
				],
				'tool_calls'
			)
		);
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const } : undefined
		);

		await chat( onEvent );

		expect( requests ).toHaveLength( 1 );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'text', text: 'I shortened it.' } );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
	} );

	it( 'takes back the text when the edit after it failed', async () => {
		const requests = respond(
			answer(
				[
					{ channel: 'content', text: 'I shortened it.' },
					{ channel: 'content', functionCall: { id: 'call_1', name: EDIT_TOOL.name, args: EDIT } },
				],
				'tool_calls'
			),
			text
		);
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'failed' as const, reason: 'Invalid markup.' } : undefined
		);

		await chat( onEvent );

		expect( requests ).toHaveLength( 2 );
		expect( onEvent ).toHaveBeenCalledWith( { type: 'discard_text', text: 'I shortened it.' } );
	} );

	it( 'applies the edit, and sends the result back for the model to go on', async () => {
		const call = toolCall( EDIT );
		const requests = respond( call, text );
		const onEvent = vi.fn( ( event: AiStreamEvent ) =>
			event.type === 'edit' ? { status: 'applied' as const, refs: [ 'b3' ] } : undefined
		);

		await chat( onEvent );

		expect( onEvent ).toHaveBeenCalledWith( { type: 'edit', edit: EDIT } );
		expect( requests ).toHaveLength( 2 );
		expect( requests[ 1 ].messages ).toEqual( [
			{ role: 'user', parts: [ { text: 'Rewrite this' } ] },
			call.message,
			{
				role: 'user',
				parts: [
					{
						functionResponse: {
							id: 'call_1',
							name: 'edit_blocks',
							response: 'The edit was applied. The reference IDs of the new blocks are b3.',
						},
					},
				],
			},
		] );
	} );

	it( 'tells the model when the selection no longer exists', async () => {
		const requests = respond( toolCall( EDIT ), text );

		await chat();

		expect( requests[ 1 ].messages[ 2 ].parts[ 0 ].functionResponse.response ).toBe(
			'The selected blocks no longer exist, so the edit was not applied.'
		);
	} );

	it( 'gives up after the model fails to fix its edit three times', async () => {
		const bad = toolCall( { action: 'replace' } );
		const requests = respond( bad, bad, bad, bad, text );
		const onEvent = vi.fn();

		await expect( chat( onEvent ) ).rejects.toThrow( 'The edit could not be made.' );

		expect( requests ).toHaveLength( 4 );
		expect( requests[ 1 ].messages[ 2 ].parts[ 0 ].functionResponse.response ).toContain(
			'edit_blocks'
		);
		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );

	it( 'does not apply a call to another tool', async () => {
		respond( toolCall( EDIT, 'other_tool' ), text );
		const onEvent = vi.fn();

		await chat( onEvent );

		expect( onEvent ).not.toHaveBeenCalledWith( expect.objectContaining( { type: 'edit' } ) );
	} );

	it( 'rejects with the message of an error response', async () => {
		vi.mocked( apiFetch ).mockReset();
		vi.mocked( apiFetch ).mockRejectedValueOnce( {
			code: 'prompt_prevented',
			message: 'AI is turned off on this site.',
		} );

		await expect( chat() ).rejects.toThrow( 'AI is turned off on this site.' );
	} );

	it( 'rejects with the AbortError when the answer is stopped', async () => {
		vi.mocked( apiFetch ).mockReset();
		vi.mocked( apiFetch ).mockRejectedValueOnce(
			new DOMException( 'The user aborted a request.', 'AbortError' )
		);

		await expect( chat() ).rejects.toMatchObject( { name: 'AbortError' } );
	} );
} );

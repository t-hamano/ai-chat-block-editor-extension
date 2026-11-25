/**
 * External dependencies
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import {
	IDLE_TIMEOUT,
	readEvents,
	requestAnswer,
	resetStreamDetection,
	type AnswerEvent,
} from '../transport';
import { streamBody } from './stream-body';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );

const LOST = 'The connection was lost before the answer was finished.';

async function readAll( events: AsyncIterable< AnswerEvent > ) {
	const read: AnswerEvent[] = [];
	for await ( const event of events ) {
		read.push( event );
	}
	return read;
}

function relayError( message: string ) {
	return `\n\nevent: blocktune_error\ndata: ${ JSON.stringify( { message } ) }\n\n`;
}

function request( signal = new AbortController().signal ) {
	return requestAnswer( {
		provider: 'anthropic',
		postId: 1,
		body: {},
		signal,
		readError: async ( response: Response ) => `Error ${ response.status }`,
		toEvents: ( answer ) => [ { event: 'whole', data: answer } ],
	} );
}

describe( 'readEvents', () => {
	it( 'reads the data of each event from JSON', async () => {
		expect(
			await readAll(
				readEvents( streamBody( [ 'event: a\ndata: {"n":1}\n\n', 'data: [2]\n\n' ] ) )
			)
		).toEqual( [
			{ event: 'a', data: { n: 1 } },
			{ event: 'message', data: [ 2 ] },
		] );
	} );

	it( "rejects with the relay's message", async () => {
		const events = readEvents( streamBody( [ 'data: {}\n\n', relayError( 'Too slow.' ) ] ) );

		await expect( readAll( events ) ).rejects.toThrow( 'Too slow.' );
	} );

	it( "rejects with the relay's message after an event it cut off", async () => {
		const events = readEvents( streamBody( [ 'data: {"text":"Hel', relayError( 'Too slow.' ) ] ) );

		await expect( readAll( events ) ).rejects.toThrow( 'Too slow.' );
	} );

	it( 'rejects when the last event was cut off', async () => {
		const events = readEvents( streamBody( [ 'data: {}\n\n', 'data: {"text":"Hel' ] ) );

		await expect( readAll( events ) ).rejects.toThrow( LOST );
	} );
} );

describe( 'requestAnswer', () => {
	beforeEach( () => {
		resetStreamDetection();
		vi.mocked( apiFetch ).mockReset();
	} );

	afterEach( () => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	const whole = () =>
		new Response( '{"text":"Hi"}', { headers: { 'content-type': 'application/json' } } );
	const sentStream = () =>
		vi.mocked( apiFetch ).mock.calls.map( ( [ options ] ) => ( options.data as any ).stream );

	it( 'streams the events of the answer', async () => {
		vi.mocked( apiFetch ).mockResolvedValueOnce( new Response( streamBody( [ 'data: {}\n\n' ] ) ) );

		expect( await readAll( request() ) ).toEqual( [ { event: 'message', data: {} } ] );
		expect( vi.mocked( apiFetch ).mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			path: '/blocktune/v1/chat',
			data: { provider: 'anthropic', post_id: 1, stream: true, body: {} },
		} );
	} );

	it( 'rejects with the message of an error response', async () => {
		vi.mocked( apiFetch ).mockRejectedValueOnce(
			new Response( '{}', { status: 401, headers: { 'content-type': 'application/json' } } )
		);

		await expect( readAll( request() ) ).rejects.toThrow( 'Error 401' );
	} );

	it( 'rejects with the message of a request that failed', async () => {
		vi.mocked( apiFetch ).mockRejectedValueOnce( {
			code: 'fetch_error',
			message: 'You are probably offline.',
		} );

		await expect( readAll( request() ) ).rejects.toThrow( 'You are probably offline.' );
	} );

	it( 'rejects when the connection drops', async () => {
		let pulls = 0;
		const body = new ReadableStream( {
			pull( controller ) {
				if ( pulls++ ) {
					controller.error( new TypeError( 'network error' ) );
				} else {
					controller.enqueue( new TextEncoder().encode( 'data: {}\n\n' ) );
				}
			},
		} );
		vi.mocked( apiFetch ).mockResolvedValueOnce( new Response( body ) );

		await expect( readAll( request() ) ).rejects.toThrow( LOST );
	} );

	it( 'stops the answer when nothing arrives for too long', async () => {
		vi.useFakeTimers();
		// A body that never sends anything.
		vi.mocked( apiFetch ).mockResolvedValueOnce( new Response( new ReadableStream() ) );

		const done = readAll( request() ).catch( ( error ) => error );
		await vi.advanceTimersByTimeAsync( IDLE_TIMEOUT );

		expect( ( await done ).message ).toMatch( 'The answer took too long' );
	} );

	it( 'rejects with an AbortError when the user stops the answer', async () => {
		const controller = new AbortController();
		vi.mocked( apiFetch ).mockResolvedValueOnce( new Response( new ReadableStream() ) );

		const done = readAll( request( controller.signal ) ).catch( ( error ) => error );
		controller.abort();

		expect( await done ).toMatchObject( { name: 'AbortError' } );
	} );

	it( 'asks for the whole answer when a server in between fails the stream', async () => {
		vi.mocked( apiFetch )
			.mockRejectedValueOnce(
				new Response( '<html>Gateway Timeout</html>', {
					status: 504,
					headers: { 'content-type': 'text/html' },
				} )
			)
			.mockResolvedValueOnce( whole() )
			.mockResolvedValueOnce( whole() );

		expect( await readAll( request() ) ).toEqual( [ { event: 'whole', data: { text: 'Hi' } } ] );
		// Later answers are asked for all at once.
		await readAll( request() );
		expect( sentStream() ).toEqual( [ true, false, false ] );
	} );

	it( 'asks for the whole answer when the stream ends before anything arrives', async () => {
		vi.mocked( apiFetch )
			.mockResolvedValueOnce( new Response( streamBody( [] ) ) )
			.mockResolvedValueOnce( whole() );

		expect( await readAll( request() ) ).toEqual( [ { event: 'whole', data: { text: 'Hi' } } ] );
		expect( sentStream() ).toEqual( [ true, false ] );
	} );

	it( 'does not ask again when the provider answers with an error', async () => {
		vi.mocked( apiFetch ).mockRejectedValueOnce(
			new Response( '{}', { status: 400, headers: { 'content-type': 'application/json' } } )
		);

		await expect( readAll( request() ) ).rejects.toThrow( 'Error 400' );
		expect( sentStream() ).toEqual( [ true ] );
	} );

	it( 'asks for whole answers after a streamed one arrives all at once', async () => {
		const pieces = [ 'data: {}\n\n', 'data: {}\n\n', 'data: {}\n\n' ];
		vi.mocked( apiFetch )
			.mockResolvedValueOnce( new Response( streamBody( pieces ) ) )
			.mockResolvedValueOnce( whole() );
		// Sent at 0, and every piece arrives 3 seconds later.
		vi.spyOn( Date, 'now' ).mockReturnValueOnce( 0 ).mockReturnValue( 3000 );

		expect( await readAll( request() ) ).toHaveLength( 3 );
		await readAll( request() );
		expect( sentStream() ).toEqual( [ true, false ] );
	} );

	it( 'keeps streaming when the pieces arrive over time', async () => {
		const pieces = [ 'data: {}\n\n', 'data: {}\n\n', 'data: {}\n\n' ];
		vi.mocked( apiFetch )
			.mockResolvedValueOnce( new Response( streamBody( pieces ) ) )
			.mockResolvedValueOnce( new Response( streamBody( pieces ) ) );
		vi.spyOn( Date, 'now' )
			.mockReturnValueOnce( 0 )
			.mockReturnValueOnce( 3000 )
			.mockReturnValueOnce( 3500 )
			.mockReturnValue( 4000 );

		await readAll( request() );
		await readAll( request() );
		expect( sentStream() ).toEqual( [ true, true ] );
	} );

	it( 'stops a whole answer that takes too long', async () => {
		vi.useFakeTimers();
		vi.mocked( apiFetch )
			.mockResolvedValueOnce( new Response( streamBody( [] ) ) )
			// A request that never answers until it is aborted.
			.mockImplementationOnce(
				( options: any ) =>
					new Promise( ( _, reject ) =>
						options.signal.addEventListener( 'abort', () =>
							reject( new DOMException( 'Aborted', 'AbortError' ) )
						)
					)
			);

		const done = readAll( request() ).catch( ( error ) => error );
		await vi.advanceTimersByTimeAsync( IDLE_TIMEOUT );

		expect( ( await done ).message ).toMatch( 'The answer took too long' );
		expect( sentStream() ).toEqual( [ true, false ] );
	} );
} );

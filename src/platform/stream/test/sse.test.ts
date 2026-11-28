/**
 * External dependencies
 */
import { describe, expect, it } from 'vitest';

/**
 * Internal dependencies
 */
import { readSse, type SseEvent } from '../sse';
import { streamBody } from './stream-body';

async function readAll( pieces: string[] ) {
	const events: SseEvent[] = [];
	for await ( const event of readSse( streamBody( pieces ) ) ) {
		events.push( event );
	}
	return events;
}

describe( 'readSse', () => {
	it( 'reads events that arrive split across pieces', async () => {
		expect(
			await readAll( [ 'event: ping\nda', 'ta: {}\n', '\nevent: text\ndata: {"a":1}\n\n' ] )
		).toEqual( [
			{ event: 'ping', data: '{}' },
			{ event: 'text', data: '{"a":1}' },
		] );
	} );

	it( 'joins data lines, and reads CR LF line ends', async () => {
		expect( await readAll( [ 'data: one\r\ndata: two\r\n\r\n' ] ) ).toEqual( [
			{ event: 'message', data: 'one\ntwo' },
		] );
	} );

	it( 'skips comments', async () => {
		expect( await readAll( [ ': keep alive\n\ndata: x\n\n' ] ) ).toEqual( [
			{ event: 'message', data: 'x' },
		] );
	} );

	it( 'ends the last event when the stream ends without an empty line', async () => {
		expect( await readAll( [ 'event: done\ndata: 1' ] ) ).toEqual( [
			{ event: 'done', data: '1' },
		] );
	} );

	it( 'reads characters split between pieces', async () => {
		const bytes = new TextEncoder().encode( 'data: こんにちは\n\n' );
		const body = new ReadableStream< Uint8Array >( {
			start( controller ) {
				controller.enqueue( bytes.slice( 0, 8 ) );
				controller.enqueue( bytes.slice( 8 ) );
				controller.close();
			},
		} );
		const events: SseEvent[] = [];
		for await ( const event of readSse( body ) ) {
			events.push( event );
		}
		expect( events ).toEqual( [ { event: 'message', data: 'こんにちは' } ] );
	} );
} );

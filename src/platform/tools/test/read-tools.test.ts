/**
 * External dependencies
 */
import { describe, expect, it, vi } from 'vitest';

/**
 * Internal dependencies
 */
import { getToolActivity, runRead, toRead } from '../read-tools';

describe( 'toRead', () => {
	it( 'reads the request of each read tool', () => {
		expect( toRead( 'read_blocks', { refs: [ 'b1', 'b2' ] } ) ).toEqual( {
			tool: 'read_blocks',
			refs: [ 'b1', 'b2' ],
		} );
		expect( toRead( 'find_blocks', { query: ' Hello ' } ) ).toEqual( {
			tool: 'find_blocks',
			query: 'Hello',
		} );
	} );

	it( 'returns null for input that does not match the tool', () => {
		expect( toRead( 'read_blocks', { refs: [] } ) ).toBeNull();
		expect( toRead( 'read_blocks', { refs: 'b1' } ) ).toBeNull();
		expect( toRead( 'find_blocks', { query: ' ' } ) ).toBeNull();
	} );

	it( 'returns undefined for other tools', () => {
		expect( toRead( 'edit_blocks', { refs: [ 'b1' ] } ) ).toBeUndefined();
	} );
} );

describe( 'runRead', () => {
	it( 'passes the request to the editor', () => {
		const read = vi.fn( () => ( { status: 'done' as const, content: 'Found' } ) );
		expect( runRead( 'find_blocks', { query: 'a' }, read ) ).toEqual( {
			status: 'done',
			content: 'Found',
		} );
		expect( read ).toHaveBeenCalledWith( { tool: 'find_blocks', query: 'a' } );
	} );

	it( 'fails for invalid input, or without a document', () => {
		expect( runRead( 'read_blocks', {}, vi.fn() ) ).toMatchObject( { status: 'failed' } );
		expect( runRead( 'read_blocks', { refs: [ 'b1' ] }, undefined ) ).toEqual( {
			status: 'failed',
			reason: 'The document is not available.',
		} );
	} );

	it( 'leaves other tools alone', () => {
		expect( runRead( 'edit_blocks', {}, vi.fn() ) ).toBeNull();
	} );
} );

describe( 'getToolActivity', () => {
	it( 'tells reading from editing', () => {
		expect( getToolActivity( 'read_blocks' ) ).toBe( 'reading' );
		expect( getToolActivity( 'edit_blocks' ) ).toBe( 'editing' );
	} );
} );

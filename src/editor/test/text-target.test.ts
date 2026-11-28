// @vitest-environment jsdom

/**
 * External dependencies
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { createBlock, registerBlockType, serialize } from '@wordpress/blocks';
import { dispatch, select } from '@wordpress/data';
import { createElement, RawHTML } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { getRef } from '../block-refs';
import { createSelectionTarget, getTextSelection } from '../text-target';

const paragraph = ( content: string ) =>
	`<!-- wp:test/text -->\n<p>${ content }</p>\n<!-- /wp:test/text -->`;

beforeAll( () => {
	registerBlockType( 'test/text', {
		apiVersion: 3,
		title: 'Text',
		category: 'text',
		attributes: {
			content: { type: 'rich-text', source: 'rich-text', selector: 'p' },
		},
		edit: () => null,
		save: ( { attributes } ) =>
			createElement(
				'p',
				{},
				createElement( RawHTML, { children: String( attributes.content ) } )
			),
	} );
} );

function setUp( ...contents: string[] ) {
	const blocks = contents.map( ( content ) => createBlock( 'test/text', { content } ) );
	dispatch( blockEditorStore ).resetBlocks( blocks );
	return blocks.map( ( block ) => block.clientId );
}

function selectText( clientId: string, start: number, end: number ) {
	dispatch( blockEditorStore ).selectionChange( clientId, 'content', start, end );
}

const documentNow = () => serialize( select( blockEditorStore ).getBlocks() );

describe( 'createSelectionTarget', () => {
	beforeEach( () => {
		dispatch( blockEditorStore ).clearSelectedBlock();
	} );

	it( 'uses the blocks when the selection is collapsed', () => {
		const [ id ] = setUp( 'One two' );
		selectText( id, 2, 2 );

		expect( getTextSelection() ).toBeNull();
		expect( createSelectionTarget().getContext() ).not.toHaveProperty( 'textIn' );
	} );

	it( 'sends the selected text as inline HTML, with the block it is in', () => {
		const [ id ] = setUp( 'One <strong>two</strong> three' );
		selectText( id, 4, 11 );

		expect( createSelectionTarget().getContext() ).toEqual( {
			document: `<!-- ${ getRef( id ) } -->${ paragraph( 'One <strong>two</strong> three' ) }`,
			selection: '<strong>two</strong> thr',
			textIn: getRef( id ),
		} );
	} );

	it( 'replaces only the selected text, and keeps it selected', () => {
		const [ id ] = setUp( 'One two three' );
		selectText( id, 4, 7 );
		const target = createSelectionTarget();

		expect( target.apply( { action: 'replace', markup: '<em>2</em>' } ) ).toEqual( {
			status: 'applied',
			refs: [ getRef( id ) ],
		} );
		expect( documentNow() ).toBe( paragraph( 'One <em>2</em> three' ) );
		expect( getTextSelection() ).toEqual( {
			clientId: id,
			attributeKey: 'content',
			start: 4,
			end: 5,
		} );

		target.apply( { action: 'replace', markup: 'four' } );
		expect( documentNow() ).toBe( paragraph( 'One four three' ) );
	} );

	it( 'rejects block markup for the selected text', () => {
		const [ id ] = setUp( 'One two' );
		selectText( id, 0, 3 );
		const target = createSelectionTarget();

		for ( const markup of [ paragraph( 'New' ), '<p>New</p>' ] ) {
			expect( target.apply( { action: 'replace', markup } ) ).toHaveProperty( 'status', 'failed' );
		}
		expect( documentNow() ).toBe( paragraph( 'One two' ) );
	} );

	it( 'rejects HTML that can run code for the selected text', () => {
		const [ id ] = setUp( 'One two' );
		selectText( id, 0, 3 );
		const target = createSelectionTarget();

		for ( const markup of [
			'<script>run()</script>',
			'<img src="x" onerror="run()">',
			'<a href="javascript:run()">New</a>',
			'<style>body{}</style>',
		] ) {
			expect( target.apply( { action: 'replace', markup } ) ).toMatchObject( {
				status: 'failed',
				reason: expect.stringContaining( 'HTML that you cannot write' ),
			} );
		}
		expect( documentNow() ).toBe( paragraph( 'One two' ) );
	} );

	it( 'keeps HTML that can run code that the text already has', () => {
		const link = '<a href="javascript:run()">two</a>';
		const [ id ] = setUp( `One ${ link }` );
		selectText( id, 0, 7 );

		expect(
			createSelectionTarget().apply( { action: 'replace', markup: `New ${ link }` } )
		).toHaveProperty( 'status', 'applied' );
		expect( documentNow() ).toBe( paragraph( `New ${ link }` ) );
	} );

	it( 'inserts blocks after the block that holds the text', () => {
		const [ id ] = setUp( 'One two', 'Three' );
		selectText( id, 0, 3 );

		createSelectionTarget().apply( { action: 'insert_after', markup: paragraph( 'New' ) } );
		expect( documentNow() ).toBe(
			[ paragraph( 'One two' ), paragraph( 'New' ), paragraph( 'Three' ) ].join( '\n\n' )
		);
	} );

	it( 'fails, and tells why, when the text changed after it was selected', () => {
		const [ id ] = setUp( 'One two' );
		selectText( id, 0, 3 );
		const target = createSelectionTarget();
		dispatch( blockEditorStore ).updateBlockAttributes( id, { content: 'Changed' } );

		expect( target.apply( { action: 'replace', markup: 'New' } ) ).toEqual( {
			status: 'failed',
			reason: expect.stringContaining( 'The user changed the text of the block' ),
		} );
		expect(
			target.apply( { action: 'replace_block', ref: getRef( id ), markup: paragraph( 'New' ) } )
		).toMatchObject( { status: 'failed' } );
		expect( documentNow() ).toBe( paragraph( 'Changed' ) );

		target.markRead( [ getRef( id ) ] );
		expect(
			target.apply( { action: 'replace_block', ref: getRef( id ), markup: paragraph( 'New' ) } )
		).toMatchObject( { status: 'applied' } );
	} );

	it( 'goes on editing the block after it replaced the selected text', () => {
		const [ id ] = setUp( 'One two' );
		selectText( id, 0, 3 );
		const target = createSelectionTarget();

		expect( target.apply( { action: 'replace', markup: 'Six' } ) ).toMatchObject( {
			status: 'applied',
		} );
		expect(
			target.apply( { action: 'replace_block', ref: getRef( id ), markup: paragraph( 'New' ) } )
		).toMatchObject( { status: 'applied' } );
		expect( documentNow() ).toBe( paragraph( 'New' ) );
	} );
} );

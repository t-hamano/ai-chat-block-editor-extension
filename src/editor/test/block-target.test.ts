// @vitest-environment jsdom

/**
 * External dependencies
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { InnerBlocks, store as blockEditorStore } from '@wordpress/block-editor';
import { createBlock, registerBlockType, serialize } from '@wordpress/blocks';
import { dispatch, select } from '@wordpress/data';
import { createElement } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { getRef, stripRefs } from '../block-refs';
import { createBlockTarget } from '../block-target';

const paragraph = ( content: string ) =>
	`<!-- wp:test/paragraph -->\n<p>${ content }</p>\n<!-- /wp:test/paragraph -->`;

beforeAll( () => {
	registerBlockType( 'test/paragraph', {
		apiVersion: 3,
		title: 'Paragraph',
		category: 'text',
		attributes: {
			content: { type: 'string', source: 'html', selector: 'p' },
		},
		edit: () => null,
		save: ( { attributes } ) => createElement( 'p', {}, attributes.content as string ),
	} );
	registerBlockType( 'test/list', {
		apiVersion: 3,
		title: 'List',
		category: 'text',
		allowedBlocks: [ 'test/list-item' ],
		edit: () => null,
		attributes: {},
		save: () => createElement( 'ul', {}, createElement( InnerBlocks.Content ) ),
	} );
	registerBlockType( 'test/list-item', {
		apiVersion: 3,
		title: 'List item',
		category: 'text',
		parent: [ 'test/list' ],
		attributes: {
			content: { type: 'string', source: 'html', selector: 'li' },
		},
		edit: () => null,
		save: ( { attributes } ) => createElement( 'li', {}, attributes.content as string ),
	} );
	registerBlockType( 'test/footnote', {
		apiVersion: 3,
		title: 'Footnote',
		category: 'text',
		ancestor: [ 'test/list' ],
		attributes: {},
		edit: () => null,
		save: () => createElement( 'small' ),
	} );
} );

function setUp( ...contents: string[] ) {
	const blocks = contents.map( ( content ) => createBlock( 'test/paragraph', { content } ) );
	dispatch( blockEditorStore ).resetBlocks( blocks );
	return blocks.map( ( block ) => block.clientId );
}

const documentNow = () => serialize( select( blockEditorStore ).getBlocks() );

describe( 'createBlockTarget', () => {
	beforeEach( () => {
		dispatch( blockEditorStore ).clearSelectedBlock();
	} );

	it( 'sends the document and the selected blocks as markup', () => {
		const ids = setUp( 'One', 'Two' );
		dispatch( blockEditorStore ).selectBlock( ids[ 1 ] );

		const ref = ( index: number ) => `<!-- ref:${ getRef( ids[ index ] ) } -->`;
		expect( createBlockTarget().getContext() ).toEqual( {
			document: `${ ref( 0 ) }${ paragraph( 'One' ) }\n\n${ ref( 1 ) }${ paragraph( 'Two' ) }`,
			selection: `${ ref( 1 ) }${ paragraph( 'Two' ) }`,
		} );
	} );

	it( 'replaces the selection, and inserts after what it replaced', () => {
		const [ first ] = setUp( 'One', 'Two' );
		dispatch( blockEditorStore ).selectBlock( first );
		const target = createBlockTarget();

		expect( target.apply( { action: 'replace', markup: paragraph( 'New' ) } ) ).toEqual( {
			status: 'applied',
			refs: [ expect.any( String ) ],
		} );
		expect( target.apply( { action: 'insert_after', markup: paragraph( 'Added' ) } ) ).toEqual( {
			status: 'applied',
			refs: [ expect.any( String ) ],
		} );
		expect( target.apply( { action: 'insert_after', markup: paragraph( 'Later' ) } ) ).toEqual( {
			status: 'applied',
			refs: [ expect.any( String ) ],
		} );

		expect( documentNow() ).toBe(
			[ 'New', 'Added', 'Later', 'Two' ].map( paragraph ).join( '\n\n' )
		);
		expect( stripRefs( target.getContext().selection ) ).toBe( paragraph( 'New' ) );
	} );

	it( 'adds blocks to the end of the document when nothing is selected', () => {
		setUp( 'One' );
		const target = createBlockTarget();

		expect( target.apply( { action: 'replace', markup: paragraph( 'New' ) } ) ).toMatchObject( {
			status: 'failed',
		} );
		expect( target.apply( { action: 'insert_after', markup: paragraph( 'Two' ) } ) ).toEqual( {
			status: 'applied',
			refs: [ expect.any( String ) ],
		} );
		expect( documentNow() ).toBe( [ 'One', 'Two' ].map( paragraph ).join( '\n\n' ) );
	} );

	it( 'fails without blocks in the markup', () => {
		const [ first ] = setUp( 'One' );
		dispatch( blockEditorStore ).selectBlock( first );

		expect( createBlockTarget().apply( { action: 'replace', markup: '' } ) ).toMatchObject( {
			status: 'failed',
		} );
		expect( documentNow() ).toBe( paragraph( 'One' ) );
	} );

	it( 'does not apply markup that fails validation, and tells why', () => {
		const [ first ] = setUp( 'One' );
		dispatch( blockEditorStore ).selectBlock( first );

		const result = createBlockTarget().apply( {
			action: 'replace',
			markup: '<!-- wp:test/missing -->\n<p>New</p>\n<!-- /wp:test/missing -->',
		} );

		expect( result ).toEqual( {
			status: 'failed',
			reason: expect.stringContaining( 'test/missing block is not registered' ),
		} );
		expect( documentNow() ).toBe( paragraph( 'One' ) );
	} );

	it( 'applies markup whose HTML was fixed automatically, and says what changed', () => {
		const [ first ] = setUp( 'One' );
		dispatch( blockEditorStore ).selectBlock( first );

		const result = createBlockTarget().apply( {
			action: 'replace',
			markup: '<!-- wp:test/paragraph -->\n<p data-drift="1">New</p>\n<!-- /wp:test/paragraph -->',
		} );

		expect( result ).toEqual( {
			status: 'applied',
			refs: [ expect.any( String ) ],
			autoFix: expect.stringContaining( `After:\n${ paragraph( 'New' ) }` ),
		} );
		expect( documentNow() ).toBe( paragraph( 'New' ) );
	} );

	it( 'drops the edit when the selected blocks are gone', () => {
		const [ first ] = setUp( 'One' );
		dispatch( blockEditorStore ).selectBlock( first );
		const target = createBlockTarget();
		setUp( 'Other' );

		expect( target.apply( { action: 'replace', markup: paragraph( 'New' ) } ) ).toEqual( {
			status: 'dropped',
		} );
		expect( documentNow() ).toBe( paragraph( 'Other' ) );
	} );

	it( 'edits the blocks the reference IDs point at, wherever the selection is', () => {
		const [ first, second, third ] = setUp( 'One', 'Two', 'Three' );
		dispatch( blockEditorStore ).selectBlock( first );
		const target = createBlockTarget();

		const replaced = target.apply( {
			action: 'replace_block',
			ref: getRef( second ),
			markup: paragraph( 'Second' ),
		} );
		expect( replaced ).toEqual( { status: 'applied', refs: [ expect.any( String ) ] } );
		expect(
			target.apply( {
				action: 'insert_before',
				ref: getRef( third ),
				markup: paragraph( 'Before' ),
			} )
		).toMatchObject( { status: 'applied' } );
		// The model can go on with the block it added, by the ID it was given.
		const [ added ] = ( replaced as { refs: string[] } ).refs;
		expect(
			target.apply( { action: 'insert_after', ref: added, markup: paragraph( 'After' ) } )
		).toMatchObject( { status: 'applied' } );
		expect( target.apply( { action: 'delete_block', ref: getRef( third ), markup: '' } ) ).toEqual(
			{ status: 'applied', refs: [] }
		);
		expect( target.apply( { action: 'append', markup: paragraph( 'End' ) } ) ).toMatchObject( {
			status: 'applied',
		} );

		expect( documentNow() ).toBe(
			[ 'One', 'Second', 'After', 'Before', 'End' ].map( paragraph ).join( '\n\n' )
		);
		expect( select( blockEditorStore ).getSelectedBlockClientId() ).toBe( first );
	} );

	it( 'tells where a block that is not allowed can go', () => {
		const item = createBlock( 'test/list-item', { content: 'Item' } );
		dispatch( blockEditorStore ).resetBlocks( [
			createBlock( 'test/paragraph', { content: 'One' } ),
			createBlock( 'test/list', {}, [ item ] ),
		] );
		const before = documentNow();
		const target = createBlockTarget();

		expect(
			target.apply( {
				action: 'append',
				markup: '<!-- wp:test/list-item -->\n<li>New</li>\n<!-- /wp:test/list-item -->',
			} )
		).toEqual( {
			status: 'failed',
			reason:
				'The "test/list-item" block is not allowed here. It can only be placed directly inside "test/list".',
		} );
		expect(
			target.apply( {
				action: 'append',
				markup: '<!-- wp:test/footnote -->\n<small></small>\n<!-- /wp:test/footnote -->',
			} )
		).toEqual( {
			status: 'failed',
			reason:
				'The "test/footnote" block is not allowed here. It can only be placed somewhere inside "test/list".',
		} );
		expect(
			target.apply( {
				action: 'insert_after',
				ref: getRef( item.clientId ),
				markup: paragraph( 'New' ),
			} )
		).toEqual( {
			status: 'failed',
			reason:
				'The "test/paragraph" block is not allowed here. The parent "test/list" block only accepts "test/list-item" inside it.',
		} );
		expect( documentNow() ).toBe( before );
	} );

	it( 'strips reference IDs from the markup', () => {
		const [ first ] = setUp( 'One' );
		dispatch( blockEditorStore ).selectBlock( first );

		expect(
			createBlockTarget().apply( {
				action: 'replace',
				markup: `<!-- ref:${ getRef( first ) } -->${ paragraph( 'New' ) }`,
			} )
		).toMatchObject( { status: 'applied' } );
		expect( documentNow() ).toBe( paragraph( 'New' ) );
	} );

	it( 'fails for a reference ID that is not in the document', () => {
		const [ first ] = setUp( 'One' );
		const gone = getRef( first );
		setUp( 'Other' );

		const target = createBlockTarget();
		expect( target.apply( { action: 'delete_block', ref: 'b9999', markup: '' } ) ).toEqual( {
			status: 'failed',
			reason: expect.stringContaining( 'no block with the reference ID "b9999"' ),
		} );
		expect(
			target.apply( { action: 'replace_block', ref: gone, markup: paragraph( 'New' ) } )
		).toMatchObject( { status: 'failed' } );
		expect( documentNow() ).toBe( paragraph( 'Other' ) );
	} );

	it( 'keeps the selection up to date when a selected block is replaced by its ID', () => {
		const [ first ] = setUp( 'One', 'Two' );
		dispatch( blockEditorStore ).selectBlock( first );
		const target = createBlockTarget();

		target.apply( { action: 'replace_block', ref: getRef( first ), markup: paragraph( 'New' ) } );
		expect( target.apply( { action: 'replace', markup: paragraph( 'Newer' ) } ) ).toMatchObject( {
			status: 'applied',
		} );
		expect( documentNow() ).toBe( [ 'Newer', 'Two' ].map( paragraph ).join( '\n\n' ) );
	} );
	it( 'replaces text that appears once, in the block that holds it', () => {
		const [ first, second ] = setUp( 'One', 'Two words', 'Three' );
		dispatch( blockEditorStore ).selectBlock( first );
		const target = createBlockTarget();

		const result = target.apply( { action: 'replace_text', find: 'Two', markup: 'Second' } );
		// The block is edited in place, so it keeps its reference ID.
		expect( result ).toEqual( { status: 'applied', refs: [ getRef( second ) ] } );
		expect( documentNow() ).toBe(
			[ 'One', 'Second words', 'Three' ].map( paragraph ).join( '\n\n' )
		);
		// The selection stays where it was.
		expect( select( blockEditorStore ).getSelectedBlockClientId() ).toBe( first );
		expect( select( blockEditorStore ).getBlock( first ) ).not.toBeNull();
	} );

	it( 'replaces text across blocks, and keeps the blocks that stay the same', () => {
		const [ first, second ] = setUp( 'One', 'Two', 'Three' );
		const target = createBlockTarget();

		// The reference IDs the model copies from the document are left out.
		const result = target.apply( {
			action: 'replace_text',
			find: `One</p>\n<!-- /wp:test/paragraph -->\n\n<!-- ref:${ getRef( second ) } --><!-- wp:test/paragraph -->\n<p>Two`,
			markup: `One</p>\n<!-- /wp:test/paragraph -->\n\n<!-- wp:test/paragraph -->\n<p>2`,
		} );
		expect( result ).toEqual( { status: 'applied', refs: [ expect.any( String ) ] } );
		expect( select( blockEditorStore ).getBlock( first ) ).not.toBeNull();
		expect( documentNow() ).toBe( [ 'One', '2', 'Three' ].map( paragraph ).join( '\n\n' ) );
	} );

	it( 'fails when the text is not in the document, or in more than one place', () => {
		setUp( 'Same', 'Same' );
		const target = createBlockTarget();

		expect( target.apply( { action: 'replace_text', find: 'Other', markup: 'New' } ) ).toEqual( {
			status: 'failed',
			reason: expect.stringContaining( 'not in the document' ),
		} );
		expect( target.apply( { action: 'replace_text', find: 'Same', markup: 'New' } ) ).toEqual( {
			status: 'failed',
			reason: expect.stringContaining( 'appears 2 times' ),
		} );
		expect( documentNow() ).toBe( [ 'Same', 'Same' ].map( paragraph ).join( '\n\n' ) );
	} );

	it( 'does not apply a text replacement that breaks the markup', () => {
		setUp( 'One' );

		expect(
			createBlockTarget().apply( {
				action: 'replace_text',
				find: '<p>One</p>',
				markup: '<div>One</div>',
			} )
		).toMatchObject( { status: 'failed' } );
		expect( documentNow() ).toBe( paragraph( 'One' ) );
	} );

	describe( 'locked blocks', () => {
		const locked = ( content: string, lock: Record< string, boolean > ) =>
			`<!-- wp:test/paragraph ${ JSON.stringify( { lock } ) } -->\n<p>${ content }</p>\n<!-- /wp:test/paragraph -->`;

		function setUpLocked( lock: Record< string, boolean > ) {
			const block = createBlock( 'test/paragraph', { content: 'One', lock } );
			dispatch( blockEditorStore ).resetBlocks( [ block ] );
			dispatch( blockEditorStore ).selectBlock( block.clientId );
			return block.clientId;
		}

		afterEach( () => {
			dispatch( blockEditorStore ).updateSettings( { templateLock: false } );
		} );

		it( 'edits the content of a block that cannot be removed, in place', () => {
			const id = setUpLocked( { remove: true } );
			const ref = getRef( id );

			expect(
				createBlockTarget().apply( { action: 'replace_text', find: 'One', markup: 'Two' } )
			).toEqual( { status: 'applied', refs: [ ref ] } );
			expect(
				createBlockTarget().apply( {
					action: 'replace_block',
					ref,
					markup: locked( 'Three', { remove: true } ),
				} )
			).toEqual( { status: 'applied', refs: [ ref ] } );
			expect(
				createBlockTarget().apply( {
					action: 'replace',
					markup: locked( 'Four', { remove: true } ),
				} )
			).toEqual( { status: 'applied', refs: [ ref ] } );
			expect( select( blockEditorStore ).getBlockAttributes( id ) ).toMatchObject( {
				content: 'Four',
				lock: { remove: true },
			} );
		} );

		it( 'does not replace a block that cannot be removed with other blocks', () => {
			const id = setUpLocked( { remove: true } );
			const two = locked( 'One', { remove: true } ) + '\n\n' + paragraph( 'Two' );

			expect(
				createBlockTarget().apply( { action: 'replace_block', ref: getRef( id ), markup: two } )
			).toEqual( {
				status: 'failed',
				reason: expect.stringContaining( 'cannot be replaced with other blocks' ),
			} );
			expect(
				createBlockTarget().apply( { action: 'delete_block', ref: getRef( id ), markup: '' } )
			).toEqual( { status: 'failed', reason: expect.stringContaining( 'cannot be removed' ) } );
			expect( select( blockEditorStore ).getBlock( id ) ).not.toBeNull();
		} );

		it( 'edits the content of blocks in a template that is locked', () => {
			const [ first ] = setUp( 'One', 'Two' );
			dispatch( blockEditorStore ).updateSettings( { templateLock: 'all' } );

			expect(
				createBlockTarget().apply( { action: 'replace_text', find: 'One', markup: 'First' } )
			).toEqual( { status: 'applied', refs: [ getRef( first ) ] } );
			expect(
				createBlockTarget().apply( {
					action: 'replace_block',
					ref: getRef( first ),
					markup: paragraph( 'A' ) + '\n\n' + paragraph( 'B' ),
				} )
			).toMatchObject( { status: 'failed' } );
			expect( documentNow() ).toBe( [ 'First', 'Two' ].map( paragraph ).join( '\n\n' ) );
		} );

		it( 'does not edit a block whose editing is locked', () => {
			const id = setUpLocked( { edit: true } );

			expect(
				createBlockTarget().apply( { action: 'replace_text', find: 'One', markup: 'Two' } )
			).toEqual( { status: 'failed', reason: expect.stringContaining( 'cannot be edited' ) } );
			expect(
				createBlockTarget().apply( {
					action: 'replace_block',
					ref: getRef( id ),
					markup: locked( 'One', { edit: true } ) + '\n\n' + paragraph( 'Two' ),
				} )
			).toMatchObject( { status: 'failed' } );
			expect( select( blockEditorStore ).getBlockAttributes( id )?.content ).toBe( 'One' );
		} );
	} );

	describe( 'protected attributes', () => {
		it( 'does not change the lock or the metadata of a block', () => {
			const [ first ] = setUp( 'One' );
			const target = createBlockTarget();
			const withAttributes = ( attributes: object ) =>
				`<!-- wp:test/paragraph ${ JSON.stringify( attributes ) } -->\n<p>One</p>\n<!-- /wp:test/paragraph -->`;

			for ( const attributes of [ { lock: { remove: true } }, { metadata: { name: 'Intro' } } ] ) {
				expect(
					target.apply( {
						action: 'replace_block',
						ref: getRef( first ),
						markup: withAttributes( attributes ),
					} )
				).toEqual( {
					status: 'failed',
					reason: expect.stringContaining( 'cannot be changed' ),
				} );
			}
			expect(
				target.apply( {
					action: 'insert_after',
					ref: getRef( first ),
					markup: withAttributes( { metadata: { name: 'New' } } ),
				} )
			).toEqual( {
				status: 'failed',
				reason: expect.stringContaining( 'adds a "test/paragraph" block with the "metadata"' ),
			} );
			expect( documentNow() ).toBe( paragraph( 'One' ) );
		} );

		it( 'keeps the metadata the model leaves as it is, and fails when it is removed', () => {
			const block = createBlock( 'test/paragraph', {
				content: 'One',
				// A key the editor cleared is left out of the markup.
				metadata: {
					name: 'Intro',
					bindings: { content: { source: 'core/post-meta' } },
					blockVisibility: undefined,
				},
			} );
			dispatch( blockEditorStore ).resetBlocks( [ block ] );
			const target = createBlockTarget();
			const ref = getRef( block.clientId );
			const markup = ( metadata?: object ) =>
				`<!-- wp:test/paragraph ${ metadata ? JSON.stringify( { metadata } ) : '' } -->\n<p>Two</p>\n<!-- /wp:test/paragraph -->`;

			expect( target.apply( { action: 'replace_block', ref, markup: markup() } ) ).toMatchObject( {
				status: 'failed',
			} );
			// The keys in another order are the same metadata.
			expect(
				target.apply( {
					action: 'replace_block',
					ref,
					markup: markup( {
						bindings: { content: { source: 'core/post-meta' } },
						name: 'Intro',
					} ),
				} )
			).toEqual( { status: 'applied', refs: [ ref ] } );
			expect( select( blockEditorStore ).getBlockAttributes( block.clientId ) ).toMatchObject( {
				content: 'Two',
				metadata: { name: 'Intro' },
			} );
		} );

		it( 'finds a block with metadata when blocks are inserted or moved around it', () => {
			const one = createBlock( 'test/paragraph', { content: 'One' } );
			const named = createBlock( 'test/paragraph', {
				content: 'Two',
				metadata: { name: 'Intro' },
			} );
			dispatch( blockEditorStore ).resetBlocks( [ one, named ] );
			dispatch( blockEditorStore ).multiSelect( one.clientId, named.clientId );
			const withName = ( content: string ) =>
				`<!-- wp:test/paragraph {"metadata":{"name":"Intro"}} -->\n<p>${ content }</p>\n<!-- /wp:test/paragraph -->`;

			// A paragraph inserted before the named one.
			expect(
				createBlockTarget().apply( {
					action: 'replace',
					markup: [ paragraph( 'One' ), paragraph( 'New' ), withName( 'Two' ) ].join( '\n\n' ),
				} )
			).toMatchObject( { status: 'applied' } );
			expect( documentNow() ).toBe(
				[ paragraph( 'One' ), paragraph( 'New' ), withName( 'Two' ) ].join( '\n\n' )
			);
		} );

		it( 'moves a block with metadata instead of moving the metadata to another block', () => {
			const named = createBlock( 'test/paragraph', {
				content: 'One',
				metadata: { name: 'Intro' },
			} );
			const two = createBlock( 'test/paragraph', { content: 'Two' } );
			dispatch( blockEditorStore ).resetBlocks( [ named, two ] );
			dispatch( blockEditorStore ).multiSelect( named.clientId, two.clientId );

			expect(
				createBlockTarget().apply( {
					action: 'replace',
					markup: [
						paragraph( 'Two' ),
						'<!-- wp:test/paragraph {"metadata":{"name":"Intro"}} -->\n<p>One</p>\n<!-- /wp:test/paragraph -->',
					].join( '\n\n' ),
				} )
			).toMatchObject( { status: 'applied' } );
			// The blocks were replaced, not changed in place.
			expect( select( blockEditorStore ).getBlock( named.clientId ) ).toBeNull();
			expect( select( blockEditorStore ).getBlocks()[ 1 ].attributes ).toMatchObject( {
				content: 'One',
				metadata: { name: 'Intro' },
			} );
		} );

		it( 'finds a list with a named item when a list is inserted before it', () => {
			const item = createBlock( 'test/list-item', {
				content: 'Item',
				metadata: { name: 'Named' },
			} );
			const list = createBlock( 'test/list', {}, [ item ] );
			dispatch( blockEditorStore ).resetBlocks( [ list ] );
			const listMarkup = ( items: string ) =>
				`<!-- wp:test/list -->\n<ul>${ items }</ul>\n<!-- /wp:test/list -->`;
			const itemMarkup = ( content: string, attributes = '' ) =>
				`<!-- wp:test/list-item ${ attributes }-->\n<li>${ content }</li>\n<!-- /wp:test/list-item -->`;
			const named = listMarkup( itemMarkup( 'Item', '{"metadata":{"name":"Named"}} ' ) );

			expect(
				createBlockTarget().apply( {
					action: 'replace_block',
					ref: getRef( list.clientId ),
					markup: [ listMarkup( itemMarkup( 'New' ) ), named ].join( '\n\n' ),
				} )
			).toMatchObject( { status: 'applied' } );
			expect(
				select( blockEditorStore ).getBlocks()[ 1 ].innerBlocks[ 0 ].attributes
			).toMatchObject( { metadata: { name: 'Named' } } );
		} );

		it( 'does not change the protected attributes of inner blocks', () => {
			const item = createBlock( 'test/list-item', { content: 'Item', lock: { remove: true } } );
			const list = createBlock( 'test/list', {}, [ item ] );
			dispatch( blockEditorStore ).resetBlocks( [ list ] );

			expect(
				createBlockTarget().apply( {
					action: 'replace_block',
					ref: getRef( list.clientId ),
					markup:
						'<!-- wp:test/list -->\n<ul><!-- wp:test/list-item -->\n<li>Item</li>\n<!-- /wp:test/list-item --></ul>\n<!-- /wp:test/list -->',
				} )
			).toEqual( {
				status: 'failed',
				reason: expect.stringContaining( 'the "lock" attribute of a "test/list-item" block' ),
			} );
		} );
	} );
} );

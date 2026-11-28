// @vitest-environment jsdom

/**
 * External dependencies
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * WordPress dependencies
 */
import { __unstableGetInnerBlocksProps, registerBlockType } from '@wordpress/blocks';
import { createElement, RawHTML } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { validateMarkup } from '../validate-markup';

beforeAll( () => {
	registerBlockType( 'test/text', {
		apiVersion: 3,
		title: 'Text',
		category: 'text',
		attributes: {
			content: { type: 'string', source: 'html', selector: 'p' },
			align: { type: 'string', enum: [ 'left', 'right' ] },
			dropCap: { type: 'boolean', default: false },
		},
		edit: () => null,
		save: ( { attributes } ) =>
			createElement(
				'p',
				{ className: attributes.align ? `has-text-align-${ attributes.align }` : undefined },
				attributes.content as string
			),
		deprecated: [
			{
				attributes: {
					content: { type: 'string', source: 'html', selector: 'div' },
					align: { type: 'string', enum: [ 'start', 'end' ] },
				},
				save: ( { attributes } ) => createElement( 'div', {}, attributes.content as string ),
				migrate: ( { content, align } ) => ( {
					content,
					dropCap: false,
					align: { start: 'left', end: 'right' }[ align as string ],
				} ),
			},
		],
	} );
	registerBlockType( 'test/group', {
		apiVersion: 3,
		title: 'Group',
		category: 'design',
		attributes: {},
		edit: () => null,
		save: () => createElement( 'div', __unstableGetInnerBlocksProps() as { children: string } ),
	} );
	registerBlockType( 'core/html', {
		apiVersion: 3,
		title: 'HTML',
		category: 'widgets',
		attributes: { content: { type: 'string', source: 'raw' } },
		edit: () => null,
		save: ( { attributes } ) =>
			createElement( RawHTML, { children: attributes.content as string } ),
	} );
	registerBlockType( 'test/rich', {
		apiVersion: 3,
		title: 'Rich text',
		category: 'text',
		attributes: { content: { type: 'string', source: 'html', selector: 'p' } },
		edit: () => null,
		save: ( { attributes } ) =>
			createElement(
				'p',
				{},
				createElement( RawHTML, { children: attributes.content as string } )
			),
	} );
	for ( const name of [ 'core/freeform', 'core/missing' ] ) {
		registerBlockType( name, {
			apiVersion: 3,
			title: name,
			category: 'text',
			attributes: {
				content: { type: 'string', source: 'raw' },
				originalName: { type: 'string' },
			},
			edit: () => null,
			save: ( { attributes } ) =>
				createElement( RawHTML, { children: attributes.content as string } ),
		} );
	}
	// The parser logs the blocks it cannot read.
	vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	vi.spyOn( console, 'info' ).mockImplementation( () => {} );
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
} );

const text = ( content: string, attrs = '' ) =>
	`<!-- wp:test/text ${ attrs }-->\n<p>${ content }</p>\n<!-- /wp:test/text -->`;

const rich = ( content: string ) =>
	`<!-- wp:test/rich -->\n<p>${ content }</p>\n<!-- /wp:test/rich -->`;

const html = ( content: string ) => `<!-- wp:html -->\n${ content }\n<!-- /wp:html -->`;

describe( 'validateMarkup', () => {
	it( 'accepts valid markup', () => {
		const result = validateMarkup( `${ text( 'One' ) }\n\n${ text( 'Two' ) }` );

		expect( result.problems ).toEqual( [] );
		expect( result.blocks.map( ( block ) => block.attributes.content ) ).toEqual( [
			'One',
			'Two',
		] );
	} );

	it( 'fixes HTML that drifted from the attributes, and says what changed', () => {
		const result = validateMarkup(
			`${ text( 'Kept' ) }\n\n<!-- wp:test/text {"align":"left"} -->\n<p>One</p>\n<!-- /wp:test/text -->`
		);

		expect( result.problems ).toEqual( [] );
		expect( result.blocks.map( ( block ) => block.attributes.content ) ).toEqual( [
			'Kept',
			'One',
		] );
		expect( result.blocks.every( ( block ) => block.isValid ) ).toBe( true );
		expect( result.autoFix ).toContain( 'fixed automatically' );
		expect( result.autoFix ).toContain(
			'Before:\n<p>One</p>\nAfter:\n<!-- wp:test/text {"align":"left"} -->\n<p class="has-text-align-left">One</p>\n<!-- /wp:test/text -->'
		);
		expect( result.autoFix ).not.toContain( 'Kept' );
	} );

	it( 'fixes drifted HTML in nested blocks', () => {
		const result = validateMarkup(
			'<!-- wp:test/group -->\n<div><!-- wp:test/text {"align":"right"} -->\n<p>One</p>\n<!-- /wp:test/text --></div>\n<!-- /wp:test/group -->'
		);

		expect( result.problems ).toEqual( [] );
		expect( result.blocks[ 0 ].innerBlocks[ 0 ].attributes ).toMatchObject( {
			content: 'One',
			align: 'right',
		} );
	} );

	it( 'does not fix HTML when the fix would lose text, and gives the markup it should be', () => {
		const result = validateMarkup(
			'<!-- wp:test/text {"align":"left"} -->\n<span>One</span>\n<!-- /wp:test/text -->'
		);

		expect( result.autoFix ).toBeUndefined();
		expect( result.problems ).toHaveLength( 1 );
		expect( result.problems[ 0 ] ).toContain( 'does not match its attributes' );
		expect( result.problems[ 0 ] ).toContain(
			'With the same attributes, the block is written as:'
		);
	} );

	it( 'does not fix HTML when the fix would lose media or links', () => {
		for ( const extra of [ '<img src="photo.jpg" alt="">', '<a href="/page"></a>' ] ) {
			const result = validateMarkup(
				`<!-- wp:test/group -->\n<div>${ extra }${ text( 'One' ) }</div>\n<!-- /wp:test/group -->`
			);

			expect( result.autoFix ).toBeUndefined();
			expect( result.problems ).toEqual( [
				expect.stringContaining( 'does not match its attributes' ),
			] );
		}
	} );

	it( 'does not fix drifted HTML when the markup has other problems', () => {
		const result = validateMarkup(
			`<!-- wp:test/text {"align":"left"} -->\n<p>One</p>\n<!-- /wp:test/text -->\n\n${ text(
				'Two',
				'{"size":"large"} '
			) }`
		);

		expect( result.autoFix ).toBeUndefined();
		expect( result.problems ).toEqual(
			expect.arrayContaining( [
				expect.stringContaining( '"size" is not an attribute' ),
				expect.stringContaining( 'does not match its attributes' ),
			] )
		);
	} );

	it( 'rejects unregistered blocks', () => {
		const { problems } = validateMarkup(
			'<!-- wp:test/missing -->\n<p>One</p>\n<!-- /wp:test/missing -->'
		);

		expect( problems ).toEqual( [
			expect.stringContaining( 'test/missing block is not registered' ),
		] );
	} );

	it( 'rejects attributes the block does not have, and values outside their enum', () => {
		const { problems } = validateMarkup(
			`${ text( 'One', '{"size":"large"} ' ) }\n\n${ text( 'Two', '{"align":"middle"} ' ) }`
		);

		expect( problems ).toEqual( [
			expect.stringContaining( '"size" is not an attribute' ),
			expect.stringContaining( 'has these attributes: align' ),
			expect.stringContaining( 'Use one of: "left", "right"' ),
			expect.stringContaining( 'has these attributes: align' ),
		] );
	} );

	it( 'rejects values of the wrong type', () => {
		const { problems } = validateMarkup( text( 'One', '{"dropCap":"true"} ' ) );

		expect( problems[ 0 ] ).toContain(
			'"true" is not a value of the "dropCap" attribute of the test/text block. Use a value of type boolean.'
		);
	} );

	it( 'rejects HTML outside blocks', () => {
		const { problems } = validateMarkup( `<p>Loose</p>\n\n${ text( 'One' ) }` );

		expect( problems ).toEqual( [ expect.stringContaining( 'not in a block' ) ] );
	} );

	it( 'checks nested blocks', () => {
		const { problems } = validateMarkup(
			`<!-- wp:test/group -->\n<div>${ text( 'One', '{"size":"large"} ' ) }</div>\n<!-- /wp:test/group -->`
		);

		expect( problems[ 0 ] ).toContain( '"size" is not an attribute of the test/text block' );
	} );

	it( 'allows core/html only when it is already in the document, unchanged', () => {
		expect(
			validateMarkup( html( '<p>Kept</p>' ), new Set( [ '<p>Kept</p>' ] ) ).problems
		).toEqual( [] );
		for ( const content of [
			'<svg viewBox="0 0 1 1"></svg>',
			'<script>run();</script>',
			'<p>Changed</p>',
		] ) {
			expect( validateMarkup( html( content ), new Set( [ '<p>Kept</p>' ] ) ).problems ).toEqual( [
				expect.stringContaining( 'You cannot write core/html blocks' ),
			] );
		}
	} );

	it( 'allows Classic blocks only when they are in the document, unchanged', () => {
		const classic = ( content: string ) =>
			`<!-- wp:freeform -->\n${ content }\n<!-- /wp:freeform -->`;

		expect(
			validateMarkup( classic( '<p>Kept</p>' ), new Set( [ '<p>Kept</p>' ] ) ).problems
		).toEqual( [] );
		expect( validateMarkup( classic( '<script>run();</script>' ) ).problems ).toEqual( [
			expect.stringContaining( 'You cannot write core/freeform (Classic) blocks' ),
		] );
		expect(
			validateMarkup(
				`<!-- wp:test/group -->\n<div>${ classic( '<script>run();</script>' ) }</div>\n<!-- /wp:test/group -->`
			).problems
		).toEqual( [ expect.stringContaining( 'You cannot write core/freeform (Classic) blocks' ) ] );
	} );

	it( 'rejects core/missing blocks', () => {
		expect(
			validateMarkup(
				'<!-- wp:missing {"originalName":"x"} -->\n<script>run();</script>\n<!-- /wp:missing -->'
			).problems
		).toEqual( [ expect.stringContaining( 'You cannot write core/missing blocks' ) ] );
	} );

	it( 'rejects HTML that can run code in blocks', () => {
		for ( const content of [
			'One<script>run();</script>',
			'One<img src="x" onerror="run()">',
			'<a href="javascript:run()">One</a>',
		] ) {
			const { problems } = validateMarkup( rich( content ) );

			expect( problems ).toEqual( [
				expect.stringContaining( 'The test/rich block has HTML that you cannot write' ),
			] );
		}
		const { problems } = validateMarkup(
			`<!-- wp:test/group -->\n<div>${ rich( 'One<script>run();</script>' ) }</div>\n<!-- /wp:test/group -->`
		);

		expect( problems ).toEqual( [ expect.stringContaining( 'the <script> element' ) ] );
	} );

	it( 'keeps HTML that can run code when the document has it', () => {
		const script = '<script>run();</script>';

		expect(
			validateMarkup( rich( `Changed${ script }` ), new Set(), new Set( [ script ] ) ).problems
		).toEqual( [] );
		expect(
			validateMarkup( rich( 'Changed<script>other();</script>' ), new Set(), new Set( [ script ] ) )
				.problems
		).toEqual( [ expect.stringContaining( 'the <script> element' ) ] );
	} );

	it( 'accepts attribute values of a deprecated version', () => {
		const result = validateMarkup(
			'<!-- wp:test/text {"align":"start"} -->\n<div>Old</div>\n<!-- /wp:test/text -->'
		);

		expect( result.problems ).toEqual( [] );
		expect( result.blocks[ 0 ].attributes.align ).toBe( 'left' );
	} );

	it( 'rejects values of a deprecated version in the current form', () => {
		const { problems } = validateMarkup( text( 'New', '{"align":"start"} ' ) );

		expect( problems[ 0 ] ).toContain( 'Use one of: "left", "right"' );
	} );

	it( 'rejects values of the current version in a deprecated form', () => {
		const { problems } = validateMarkup(
			'<!-- wp:test/text {"align":"left"} -->\n<div>Old</div>\n<!-- /wp:test/text -->'
		);

		expect( problems[ 0 ] ).toContain( 'Use one of: "start", "end"' );
	} );

	it( 'rejects attributes read from the HTML in the comment', () => {
		const { problems } = validateMarkup( text( 'Old', '{"content":"New"} ' ) );

		expect( problems[ 0 ] ).toContain( 'is read from its HTML' );
	} );

	it( 'migrates blocks written in a deprecated form', () => {
		const result = validateMarkup(
			'<!-- wp:test/text -->\n<div>Old</div>\n<!-- /wp:test/text -->'
		);

		expect( result.problems ).toEqual( [] );
		expect( result.blocks[ 0 ].attributes.content ).toBe( 'Old' );
		expect( result.blocks[ 0 ].isValid ).toBe( true );
	} );
} );

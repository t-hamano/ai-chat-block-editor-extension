// @vitest-environment jsdom

/**
 * External dependencies
 */
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { InnerBlocks } from '@wordpress/block-editor';
import {
	createBlock,
	parse,
	registerBlockType,
	serialize,
	setUnregisteredTypeHandlerName,
	type Block,
} from '@wordpress/blocks';
import { createElement, RawHTML } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { getClientIdByRef, getRef, serializeWithRefs, stripRefs } from '../block-refs';
import { splitTopLevelBlocks } from '../../ai/document-context';

beforeAll( () => {
	registerBlockType( 'test/text', {
		apiVersion: 3,
		title: 'Text',
		category: 'text',
		attributes: {
			content: { type: 'string', source: 'html', selector: 'p' },
		},
		edit: () => null,
		save: ( { attributes } ) => createElement( 'p', {}, attributes.content as string ),
	} );
	registerBlockType( 'test/box', {
		apiVersion: 3,
		title: 'Box',
		category: 'design',
		attributes: {},
		edit: () => null,
		save: () => createElement( 'div', {}, createElement( InnerBlocks.Content ) ),
	} );
	// The parser renames blocks saved with the old name `core/cover-image`.
	registerBlockType( 'core/cover', {
		apiVersion: 3,
		title: 'Cover',
		category: 'media',
		attributes: {},
		edit: () => null,
		save: () =>
			createElement( 'div', { className: 'cover' }, createElement( InnerBlocks.Content ) ),
	} );
	// Like `core/missing`, which keeps a block whose type is not registered
	// as it was saved.
	registerBlockType( 'core/missing', {
		apiVersion: 3,
		title: 'Missing',
		category: 'text',
		attributes: {
			originalName: { type: 'string' },
			originalContent: { type: 'string', source: 'raw' },
		},
		edit: () => null,
		save: ( { attributes } ) =>
			createElement( RawHTML, { children: attributes.originalContent as string } ),
	} );
	setUnregisteredTypeHandlerName( 'core/missing' );
} );

/**
 * Returns the reference ID before each opening delimiter, and the name in
 * the delimiter.
 *
 * @param markup The markup with reference IDs.
 * @return The IDs and names, such as `b1 test/text`.
 */
function refsAndNames( markup: string ): string[] {
	return [ ...markup.matchAll( /<!-- (b[0-9]+) --><!-- wp:([a-z0-9/_-]+)/g ) ].map(
		( match ) => `${ match[ 1 ] } ${ match[ 2 ] }`
	);
}

/**
 * Returns the reference ID of each block, and the block's name.
 *
 * @param blocks The blocks.
 * @return The IDs and names, such as `b1 test/text`.
 */
function blockRefs( blocks: Block[] ): string[] {
	return blocks.map( ( block ) => `${ getRef( block.clientId ) } ${ block.name }` );
}

describe( 'serializeWithRefs', () => {
	it( 'puts a reference ID before each block, nested ones too', () => {
		const inner = createBlock( 'test/text', { content: 'Inner' } );
		const box = createBlock( 'test/box', {}, [ inner ] );
		const after = createBlock( 'test/text', { content: 'After' } );
		const blocks = [ box, after ];

		const markup = serializeWithRefs( blocks );

		expect( markup ).toBe(
			[
				`<!-- ${ getRef( box.clientId ) } --><!-- wp:test/box -->`,
				`<div><!-- ${ getRef( inner.clientId ) } --><!-- wp:test/text -->`,
				'<p>Inner</p>',
				'<!-- /wp:test/text --></div>',
				'<!-- /wp:test/box -->',
				'',
				`<!-- ${ getRef( after.clientId ) } --><!-- wp:test/text -->`,
				'<p>After</p>',
				'<!-- /wp:test/text -->',
			].join( '\n' )
		);
		expect( stripRefs( markup ) ).toBe( serialize( blocks ) );
	} );

	it( 'keeps the ID of a block, and maps it back to the block', () => {
		const block = createBlock( 'test/text', { content: 'One' } );
		const ref = getRef( block.clientId );

		expect( serializeWithRefs( [ block ] ) ).toContain( `<!-- ${ ref } -->` );
		expect( getRef( block.clientId ) ).toBe( ref );
		expect( getClientIdByRef( ref ) ).toBe( block.clientId );
		expect( getClientIdByRef( 'b0' ) ).toBeUndefined();
	} );

	it( 'puts the ID of an invalid block saved with an old name before that block', () => {
		const blocks = parse(
			[
				'<!-- wp:test/text --><p>A</p><!-- /wp:test/text -->',
				'<!-- wp:cover-image --><div class="broken"></div><!-- /wp:cover-image -->',
				'<!-- wp:test/text --><p>B</p><!-- /wp:test/text -->',
				'<!-- wp:cover --><div class="cover"><!-- wp:test/text --><p>Inner</p><!-- /wp:test/text --></div><!-- /wp:cover -->',
				'<!-- wp:test/text --><p>C</p><!-- /wp:test/text -->',
			].join( '\n\n' )
		);
		expect( blocks[ 1 ] ).toMatchObject( { name: 'core/cover', isValid: false } );

		const markup = serializeWithRefs( blocks );

		const [ a, oldCover, b, cover, c ] = blockRefs( blocks );
		const inner = blockRefs( blocks[ 3 ].innerBlocks )[ 0 ];
		expect( refsAndNames( markup ) ).toEqual( [
			a,
			oldCover.replace( 'core/cover', 'cover-image' ),
			b,
			cover.replace( 'core/', '' ),
			inner,
			c,
		] );
		expect( stripRefs( markup ) ).toBe( serialize( blocks ) );
	} );

	it( 'keeps other HTML comments when removing the IDs', () => {
		const markup =
			'<!-- b1 --><!-- wp:test/text --><p>A<!--more--><!-- note --></p><!-- /wp:test/text -->';

		expect( stripRefs( markup ) ).toBe(
			'<!-- wp:test/text --><p>A<!--more--><!-- note --></p><!-- /wp:test/text -->'
		);
	} );

	it( 'puts IDs before blocks whose type is not registered', () => {
		const blocks = parse(
			[
				'<!-- wp:test/text --><p>A</p><!-- /wp:test/text -->',
				'<!-- wp:acme/unknown --><div>X</div><!-- /wp:acme/unknown -->',
				'<!-- wp:test/text --><p>B</p><!-- /wp:test/text -->',
			].join( '\n\n' )
		);

		const markup = serializeWithRefs( blocks );

		const [ a, unknown, b ] = blockRefs( blocks );
		expect( refsAndNames( markup ) ).toEqual( [
			a,
			unknown.replace( 'core/missing', 'acme/unknown' ),
			b,
		] );
		expect( stripRefs( markup ) ).toBe( serialize( blocks ) );
	} );

	it( 'puts IDs before the inner blocks of an invalid block', () => {
		const blocks = parse(
			[
				'<!-- wp:test/box --><section><!-- wp:test/text --><p>Inner</p><!-- /wp:test/text --></section><!-- /wp:test/box -->',
				'<!-- wp:test/text --><p>After</p><!-- /wp:test/text -->',
			].join( '\n\n' )
		);
		expect( blocks[ 0 ].isValid ).toBe( false );

		const markup = serializeWithRefs( blocks );

		const [ box, after ] = blockRefs( blocks );
		const inner = blockRefs( blocks[ 0 ].innerBlocks )[ 0 ];
		expect( refsAndNames( markup ) ).toEqual( [ box, inner, after ] );
		expect( stripRefs( markup ) ).toBe( serialize( blocks ) );
	} );
} );

describe( 'splitTopLevelBlocks with serializeWithRefs', () => {
	it( 'splits the serialized document at its top-level blocks', () => {
		const first = createBlock( 'test/text', { content: 'One.' } );
		const box = createBlock( 'test/box', {}, [
			createBlock( 'test/text', { content: 'Inside.' } ),
			createBlock( 'test/text', { content: 'Also inside.' } ),
		] );
		const blocks = splitTopLevelBlocks( serializeWithRefs( [ first, box ] ) );
		expect( blocks?.map( ( block ) => block.ref ) ).toEqual( [
			getRef( first.clientId ),
			getRef( box.clientId ),
		] );
		expect( blocks?.[ 1 ].markup ).toBe( serializeWithRefs( [ box ] ) );
	} );
} );

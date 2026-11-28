/**
 * External dependencies
 */
import { describe, expect, it } from 'vitest';

/**
 * Internal dependencies
 */
import { buildMessageContext, formatChanges, splitTopLevelBlocks } from '../document-context';

const paragraph = ( ref: string, text: string ) =>
	`<!-- ${ ref } --><!-- wp:paragraph -->\n<p>${ text }</p>\n<!-- /wp:paragraph -->`;

const group = ( ref: string, inner: string ) =>
	`<!-- ${ ref } --><!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">${ inner }</div>\n<!-- /wp:group -->`;

const doc = ( ...blocks: string[] ) => blocks.join( '\n\n' );

const seen = ( known: string, shown = known, added: string[] = [] ) => ( { known, shown, added } );

// A long paragraph, so that sending the changes is shorter than the whole document.
const long = 'Lorem ipsum dolor sit amet. '.repeat( 10 );

describe( 'splitTopLevelBlocks', () => {
	it( 'splits the document into top-level blocks with their nested blocks', () => {
		const inner = paragraph( 'b3', 'Inside.' );
		const document = doc(
			paragraph( 'b1', 'One.' ),
			group( 'b2', inner ),
			'<!-- b4 --><!-- wp:latest-posts {"postsToShow":3} /-->'
		);
		expect( splitTopLevelBlocks( document ) ).toEqual( [
			{ ref: 'b1', markup: paragraph( 'b1', 'One.' ) },
			{ ref: 'b2', markup: group( 'b2', inner ) },
			{ ref: 'b4', markup: '<!-- b4 --><!-- wp:latest-posts {"postsToShow":3} /-->' },
		] );
	} );

	it( 'returns null for content without a reference ID', () => {
		expect( splitTopLevelBlocks( doc( paragraph( 'b1', 'One.' ), '<p>Classic.</p>' ) ) ).toBeNull();
		expect(
			splitTopLevelBlocks( '<!-- wp:paragraph -->\n<p>One.</p>\n<!-- /wp:paragraph -->' )
		).toBeNull();
	} );

	it( 'returns null for unbalanced or repeated blocks', () => {
		expect( splitTopLevelBlocks( '<!-- b1 --><!-- wp:group --><div></div>' ) ).toBeNull();
		expect(
			splitTopLevelBlocks( doc( paragraph( 'b1', 'One.' ), paragraph( 'b1', 'Two.' ) ) )
		).toBeNull();
	} );
} );

describe( 'formatChanges', () => {
	it( 'lists changed, added, and removed blocks by reference ID', () => {
		const previous = doc(
			paragraph( 'b1', 'One.' ),
			paragraph( 'b2', 'Two.' ),
			paragraph( 'b3', 'Three.' )
		);
		const document = doc(
			paragraph( 'b1', 'One!' ),
			paragraph( 'b2', 'Two.' ),
			paragraph( 'b4', 'New.' ),
			paragraph( 'b5', 'Newer.' )
		);
		expect( formatChanges( document, seen( previous ) ) ).toBe(
			[
				'<changes>',
				'<removed refs="b3" />',
				'<blocks at="start">',
				paragraph( 'b1', 'One!' ),
				'</blocks>',
				'<blocks after="b2">',
				paragraph( 'b4', 'New.' ),
				paragraph( 'b5', 'Newer.' ),
				'</blocks>',
				'</changes>',
			].join( '\n' )
		);
	} );

	it( 'sends a moved block at its new place', () => {
		const previous = doc(
			paragraph( 'b1', 'One.' ),
			paragraph( 'b2', 'Two.' ),
			paragraph( 'b3', 'Three.' )
		);
		const document = doc(
			paragraph( 'b2', 'Two.' ),
			paragraph( 'b3', 'Three.' ),
			paragraph( 'b1', 'One.' )
		);
		expect( formatChanges( document, seen( previous ) ) ).toBe(
			[
				'<changes>',
				'<blocks after="b3">',
				paragraph( 'b1', 'One.' ),
				'</blocks>',
				'</changes>',
			].join( '\n' )
		);
	} );

	it( 'sends the whole top-level block when a nested block changed', () => {
		const previous = group( 'b1', paragraph( 'b2', 'Inside.' ) );
		const document = group( 'b1', paragraph( 'b2', 'Changed.' ) );
		expect( formatChanges( document, seen( previous ) ) ).toContain( document );
	} );

	it( 'sends the blocks the model added, whose reference IDs it has not seen', () => {
		const shown = doc( paragraph( 'b1', 'One.' ) );
		const known = doc( paragraph( 'b1', 'One.' ), paragraph( 'b2', 'Added.' ) );
		expect( formatChanges( known, seen( known, shown ) ) ).toBe(
			[
				'<changes>',
				'<blocks after="b1">',
				paragraph( 'b2', 'Added.' ),
				'</blocks>',
				'</changes>',
			].join( '\n' )
		);
	} );

	it( 'does not send the blocks the model added when it was told their reference IDs', () => {
		const shown = doc( paragraph( 'b1', 'One.' ) );
		const known = doc( paragraph( 'b1', 'One.' ), paragraph( 'b2', 'Added.' ) );
		expect( formatChanges( known, seen( known, shown, [ 'b2' ] ) ) ).toBe( '' );
		expect(
			buildMessageContext( { document: known, selection: '' }, seen( known, shown, [ 'b2' ] ) )
		).toBe( '<selection></selection>' );
	} );

	it( 'sends a block the model added when it was not told the reference IDs of its nested blocks', () => {
		const shown = doc( paragraph( 'b1', 'One.' ) );
		const added = group( 'b2', paragraph( 'b3', 'Inside.' ) );
		const known = doc( paragraph( 'b1', 'One.' ), added );
		expect( formatChanges( known, seen( known, shown, [ 'b2' ] ) ) ).toBe(
			[ '<changes>', '<blocks after="b1">', added, '</blocks>', '</changes>' ].join( '\n' )
		);
	} );

	it( 'sends a block the model added when the user changed it after the answer', () => {
		const shown = doc( paragraph( 'b1', 'One.' ) );
		const known = doc( paragraph( 'b1', 'One.' ), paragraph( 'b2', 'Added.' ) );
		const document = doc( paragraph( 'b1', 'One.' ), paragraph( 'b2', 'Changed.' ) );
		expect( formatChanges( document, seen( known, shown, [ 'b2' ] ) ) ).toBe(
			[
				'<changes>',
				'<blocks after="b1">',
				paragraph( 'b2', 'Changed.' ),
				'</blocks>',
				'</changes>',
			].join( '\n' )
		);
	} );

	it( 'sends a block the user restored after the model removed it', () => {
		const shown = doc( paragraph( 'b1', 'One.' ), paragraph( 'b2', 'Two.' ) );
		const known = doc( paragraph( 'b1', 'One.' ) );
		expect( formatChanges( shown, seen( known, shown ) ) ).toBe(
			[
				'<changes>',
				'<blocks after="b1">',
				paragraph( 'b2', 'Two.' ),
				'</blocks>',
				'</changes>',
			].join( '\n' )
		);
	} );

	it( 'returns an empty string when the model knows the document', () => {
		const document = doc( paragraph( 'b1', 'One.' ) );
		expect( formatChanges( document, seen( document ) ) ).toBe( '' );
	} );

	it( 'returns null when the changes cannot be told by reference ID', () => {
		expect( formatChanges( '<p>Classic.</p>', seen( paragraph( 'b1', 'One.' ) ) ) ).toBeNull();
	} );
} );

describe( 'buildMessageContext', () => {
	const context = { document: 'One.\n\nTwo.\n', selection: 'Two.\n' };

	it( 'sends the whole document when the model has not seen it', () => {
		expect( buildMessageContext( context, null ) ).toBe(
			'<document>\nOne.\n\nTwo.\n</document>\n\n<selection>\nTwo.\n</selection>'
		);
	} );

	it( 'sends the rules for the blocks that need more of them with the document', () => {
		const result = buildMessageContext(
			{ document: '<!-- wp:html -->\n<div>Hi</div>\n<!-- /wp:html -->\n', selection: '' },
			null
		);
		expect( result ).toMatch( /<\/document>\n\n<skill-notes>\n## Custom HTML/ );
		expect( result ).toMatch( /<\/skill-notes>\n\n<selection>/ );
	} );

	it( 'sends the rules for blocks that need more of them with the changes that add them', () => {
		const previous = doc( paragraph( 'b1', long ), paragraph( 'b2', long ) );
		const document = doc(
			previous,
			'<!-- b3 --><!-- wp:html -->\n<div>Hi</div>\n<!-- /wp:html -->'
		);
		const result = buildMessageContext( { document, selection: '' }, seen( previous ) );
		expect( result ).toContain( 'These are the changes.' );
		expect( result ).toMatch( /<\/changes>\n\n<skill-notes>\n## Custom HTML/ );
	} );

	it( 'sends an outline instead of a long document', () => {
		const blocks = Array.from( { length: 400 }, ( _, n ) => paragraph( `b${ n + 1 }`, long ) );
		const result = buildMessageContext( { document: doc( ...blocks ), selection: '' }, null );
		expect( result ).not.toContain( '<document>' );
		expect( result ).toMatch( /^<outline>\nb1 core\/paragraph: Lorem ipsum/ );
		expect( result ).toContain( '\nb400 core/paragraph: ' );
		expect( result.length ).toBeLessThan( doc( ...blocks ).length / 2 );
	} );

	it( 'sends the outline of a long document again when the changes are longer', () => {
		const blocks = Array.from( { length: 400 }, ( _, n ) => paragraph( `b${ n + 1 }`, long ) );
		const previous = doc( ...blocks );
		const document = doc( ...blocks.map( ( block ) => block.replace( 'Lorem', 'Ipsum' ) ) );
		const result = buildMessageContext( { document, selection: '' }, seen( previous ) );
		expect( result ).toMatch(
			/^The document changed after your last answer, or has blocks you added\. This is the outline of the document now\.\n\n<outline>\n/
		);
	} );

	it( 'sends only the selection when nothing changed', () => {
		expect( buildMessageContext( context, seen( context.document ) ) ).toBe(
			'<selection>\nTwo.\n</selection>'
		);
	} );

	it( 'says which block holds selected text', () => {
		expect(
			buildMessageContext( { ...context, selection: 'Tw', textIn: 'b2' }, seen( context.document ) )
		).toBe( '<selection type="text" in="b2">\nTw\n</selection>' );
	} );

	it( 'sends only the changed blocks', () => {
		const previous = doc(
			paragraph( 'b1', long ),
			paragraph( 'b2', long ),
			paragraph( 'b3', 'Old.' )
		);
		const document = doc(
			paragraph( 'b1', long ),
			paragraph( 'b2', long ),
			paragraph( 'b4', 'New.' )
		);
		const result = buildMessageContext( { document, selection: '' }, seen( previous ) );
		expect( result ).toBe(
			[
				'The document changed after your last answer, or has blocks you added. These are the changes.',
				[
					'<changes>',
					'<removed refs="b3" />',
					'<blocks after="b2">',
					paragraph( 'b4', 'New.' ),
					'</blocks>',
					'</changes>',
				].join( '\n' ),
				'<selection></selection>',
			].join( '\n\n' )
		);
		expect( result ).not.toContain( long );
	} );

	it( 'sends the whole document again when that is shorter', () => {
		const previous = doc( paragraph( 'b1', 'One.' ) );
		const document = doc( paragraph( 'b2', 'Two.' ) );
		const result = buildMessageContext( { document, selection: '' }, seen( previous ) );
		expect( result ).toContain( 'This is the whole document now.' );
		expect( result ).toContain( `<document>\n${ document }\n</document>` );
	} );

	it( 'sends the whole document again when the changes cannot be told by reference ID', () => {
		const result = buildMessageContext( context, seen( 'Old.\n' ) );
		expect( result ).toContain( 'This is the whole document now.' );
		expect( result ).toContain( '<document>\nOne.\n\nTwo.\n</document>' );
	} );

	it( 'sends the empty document when the user removed everything', () => {
		const empty = { document: '', selection: '' };
		expect( buildMessageContext( empty, seen( 'One.\n' ) ) ).toBe(
			'The document changed after your last answer, or has blocks you added. This is the whole document now.\n\n<document>\n</document>\n\n<selection></selection>'
		);
	} );
} );

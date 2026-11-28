// @vitest-environment jsdom

/**
 * External dependencies
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { createBlock, registerBlockType } from '@wordpress/blocks';
import { speak } from '@wordpress/a11y';
import { dispatch } from '@wordpress/data';
import { createElement, createRoot, flushSync } from '@wordpress/element';

/**
 * Internal dependencies
 */
import {
	HIGHLIGHT_CLASS_NAME,
	HIGHLIGHT_DURATION,
	TEXT_HIGHLIGHT_NAME,
	TEXT_OPACITY_PROPERTY,
	createTextRange,
	diffText,
	findChangedBlocks,
	highlightBlocks,
	highlightChanges,
	takeBlockSnapshot,
	withChangeHighlight,
} from '../highlight';

vi.mock( '@wordpress/a11y', () => ( { speak: vi.fn() } ) );

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
	registerBlockType( 'test/group', {
		apiVersion: 3,
		title: 'Group',
		category: 'design',
		attributes: {},
		edit: () => null,
		save: () => null,
	} );
} );

function setUp() {
	const inner = createBlock( 'test/text', { content: 'Inner' } );
	const blocks = [
		createBlock( 'test/text', { content: 'One' } ),
		createBlock( 'test/group', {}, [ inner ] ),
		createBlock( 'test/text', { content: 'Two' } ),
	];
	dispatch( blockEditorStore ).resetBlocks( blocks );
	return { one: blocks[ 0 ].clientId, group: blocks[ 1 ].clientId, inner: inner.clientId };
}

describe( 'findChangedBlocks', () => {
	it( 'finds nothing when nothing changed', () => {
		setUp();
		expect( findChangedBlocks( takeBlockSnapshot() ) ).toEqual( [] );
	} );

	it( 'finds the blocks whose attributes changed', () => {
		const { one, inner } = setUp();
		const before = takeBlockSnapshot();
		dispatch( blockEditorStore ).updateBlockAttributes( inner, { content: 'Changed' } );
		dispatch( blockEditorStore ).updateBlockAttributes( one, { content: 'Changed' } );
		expect( findChangedBlocks( before ) ).toEqual( [ one, inner ] );
	} );

	it( 'finds inserted blocks, without their inner blocks', () => {
		const { one } = setUp();
		const before = takeBlockSnapshot();
		const group = createBlock( 'test/group', {}, [ createBlock( 'test/text' ) ] );
		dispatch( blockEditorStore ).insertBlocks( [ group ], 1, undefined, false );
		expect( findChangedBlocks( before ) ).toEqual( [ group.clientId ] );
		expect( findChangedBlocks( before ) ).not.toContain( one );
	} );

	it( 'finds the blocks that replaced others', () => {
		const { group } = setUp();
		const before = takeBlockSnapshot();
		const text = createBlock( 'test/text', { content: 'New' } );
		dispatch( blockEditorStore ).replaceBlocks( [ group ], [ text ], undefined, null );
		expect( findChangedBlocks( before ) ).toEqual( [ text.clientId ] );
	} );
} );

describe( 'diffText', () => {
	it( 'finds the changed characters', () => {
		expect( diffText( 'The cat sat.', 'The dog sat.' ) ).toEqual( { start: 4, end: 7 } );
		expect( diffText( 'cat', 'car' ) ).toEqual( { start: 2, end: 3 } );
	} );

	it( 'finds added text', () => {
		expect( diffText( 'Hello world', 'Hello big world' ) ).toEqual( { start: 6, end: 10 } );
	} );

	it( 'finds nothing when text was only removed, or nothing changed', () => {
		expect( diffText( 'Hello big world', 'Hello world' ) ).toBeNull();
		expect( diffText( 'Same', 'Same' ) ).toBeNull();
	} );

	it( 'keeps characters made of two code units whole', () => {
		expect( diffText( 'a😀b', 'a😃b' ) ).toEqual( { start: 1, end: 3 } );
	} );
} );

describe( 'createTextRange', () => {
	it( 'covers the text between the offsets, across elements', () => {
		const element = document.createElement( 'p' );
		element.innerHTML = 'Hello <strong>big</strong> world';
		expect( createTextRange( element, 6, 9 )?.toString() ).toBe( 'big' );
		expect( createTextRange( element, 4, 11 )?.toString() ).toBe( 'o big w' );
		expect( createTextRange( element, 4, 99 ) ).toBeNull();
	} );
} );

describe( 'highlightChanges', () => {
	type Props = { clientId: string; className?: string; text: string };
	const Block = ( { clientId, className, text }: Props ) =>
		createElement( 'p', { id: `block-${ clientId }`, className }, text );
	const ChangeHighlight = withChangeHighlight( Block );

	let container: HTMLDivElement;
	let root: ReturnType< typeof createRoot >;
	let highlights: Map< string, { ranges: Range[] } >;

	function render( clientId: string, text: string ) {
		flushSync( () => root.render( createElement( ChangeHighlight, { clientId, text } ) ) );
	}

	beforeEach( () => {
		vi.useFakeTimers( {
			toFake: [
				'setTimeout',
				'clearTimeout',
				'requestAnimationFrame',
				'cancelAnimationFrame',
				'performance',
			],
		} );
		highlights = new Map();
		vi.stubGlobal( 'CSS', { highlights } );
		vi.stubGlobal(
			'Highlight',
			class {
				ranges: Range[];
				constructor( ...ranges: Range[] ) {
					this.ranges = ranges;
				}
			}
		);
		// The test page has no layout, so every block looks off-screen.
		Element.prototype.scrollIntoView = vi.fn();
		container = document.createElement( 'div' );
		document.body.appendChild( container );
		root = createRoot( container );
	} );

	afterEach( () => {
		vi.runOnlyPendingTimers();
		flushSync( () => root.unmount() );
		container.remove();
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.mocked( speak ).mockClear();
	} );

	it( 'highlights the blocks for a while', () => {
		render( 'a', 'A' );
		flushSync( () => highlightBlocks( [ 'a', 'b' ] ) );
		flushSync( () => vi.advanceTimersByTime( 16 ) );
		expect( container.querySelector( 'p' )?.className ).toBe( HIGHLIGHT_CLASS_NAME );

		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION ) );
		expect( container.querySelector( 'p' )?.className ).not.toContain( HIGHLIGHT_CLASS_NAME );
	} );

	it( 'keeps a block highlighted for the full time when it changes again', () => {
		render( 'a', 'A' );
		flushSync( () => highlightBlocks( [ 'a' ] ) );
		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION / 2 ) );
		flushSync( () => highlightBlocks( [ 'a' ] ) );
		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION / 2 ) );
		expect( container.querySelector( 'p' )?.className ).toBe( HIGHLIGHT_CLASS_NAME );

		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION / 2 ) );
		expect( container.querySelector( 'p' )?.className ).not.toContain( HIGHLIGHT_CLASS_NAME );
	} );

	it( 'colors the changed text until the block highlight ends', () => {
		const { one } = setUp();
		render( one, 'One' );
		const before = takeBlockSnapshot();
		dispatch( blockEditorStore ).updateBlockAttributes( one, { content: 'One more' } );
		render( one, 'One more' );
		flushSync( () => highlightChanges( before ) );
		flushSync( () => vi.advanceTimersByTime( 16 ) );

		expect( container.querySelector( 'p' )?.className ).not.toContain( HIGHLIGHT_CLASS_NAME );
		expect( highlights.get( TEXT_HIGHLIGHT_NAME )?.ranges[ 0 ].toString() ).toBe( ' more' );

		vi.advanceTimersByTime( HIGHLIGHT_DURATION * 0.8 );
		const opacity = document.documentElement.style.getPropertyValue( TEXT_OPACITY_PROPERTY );
		expect( Number( opacity ) ).toBeGreaterThan( 0 );
		expect( Number( opacity ) ).toBeLessThan( 1 );

		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION ) );
		expect( highlights.has( TEXT_HIGHLIGHT_NAME ) ).toBe( false );
	} );

	it( 'compares a replaced block with the block it replaced', () => {
		const { one } = setUp();
		render( one, 'One' );
		const before = takeBlockSnapshot();
		const text = createBlock( 'test/text', { content: 'Ones' } );
		dispatch( blockEditorStore ).replaceBlocks( [ one ], [ text ], undefined, null );
		render( text.clientId, 'Ones' );
		flushSync( () => highlightChanges( before ) );
		flushSync( () => vi.advanceTimersByTime( 16 ) );

		expect( highlights.get( TEXT_HIGHLIGHT_NAME )?.ranges[ 0 ].toString() ).toBe( 's' );
	} );

	it( 'highlights the whole block when there is no text to compare with', () => {
		setUp();
		const before = takeBlockSnapshot();
		const text = createBlock( 'test/text', { content: 'New' } );
		dispatch( blockEditorStore ).insertBlocks( [ text ], 0, undefined, false );
		render( text.clientId, 'New' );
		flushSync( () => highlightChanges( before ) );
		flushSync( () => vi.advanceTimersByTime( 16 ) );

		expect( container.querySelector( 'p' )?.className ).toBe( HIGHLIGHT_CLASS_NAME );
		expect( highlights.has( TEXT_HIGHLIGHT_NAME ) ).toBe( false );

		flushSync( () => vi.advanceTimersByTime( HIGHLIGHT_DURATION ) );
		expect( container.querySelector( 'p' )?.className ).not.toContain( HIGHLIGHT_CLASS_NAME );
	} );

	it( 'highlights the whole block when the browser cannot color text', () => {
		vi.stubGlobal( 'Highlight', undefined );
		const { one } = setUp();
		render( one, 'One' );
		const before = takeBlockSnapshot();
		dispatch( blockEditorStore ).updateBlockAttributes( one, { content: 'Ones' } );
		render( one, 'Ones' );
		flushSync( () => highlightChanges( before ) );
		flushSync( () => vi.advanceTimersByTime( 16 ) );

		expect( container.querySelector( 'p' )?.className ).toBe( HIGHLIGHT_CLASS_NAME );
	} );

	it( 'announces the change', () => {
		const { one, inner } = setUp();
		const before = takeBlockSnapshot();
		dispatch( blockEditorStore ).updateBlockAttributes( one, { content: 'Changed' } );
		dispatch( blockEditorStore ).updateBlockAttributes( inner, { content: 'Changed' } );
		highlightChanges( before );
		expect( speak ).toHaveBeenCalledWith( 'The AI changed 2 blocks.' );
	} );

	it( 'announces removed blocks, without their inner blocks', () => {
		const { one, group } = setUp();
		const before = takeBlockSnapshot();
		dispatch( blockEditorStore ).removeBlocks( [ one, group ], false );
		highlightChanges( before );
		expect( speak ).toHaveBeenCalledWith( 'The AI removed 2 blocks.' );
	} );

	it( 'announces nothing when nothing changed', () => {
		setUp();
		highlightChanges( takeBlockSnapshot() );
		expect( speak ).not.toHaveBeenCalled();
	} );
} );

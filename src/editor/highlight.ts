/**
 * WordPress dependencies
 */
import { speak } from '@wordpress/a11y';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { select } from '@wordpress/data';
import { createElement, useEffect, useState, useSyncExternalStore } from '@wordpress/element';
import { addFilter } from '@wordpress/hooks';
import { _n, sprintf } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import './canvas.scss';

/**
 * How long a changed block stays highlighted, in milliseconds. The
 * stylesheet's animation fades out over the same time.
 */
export const HIGHLIGHT_DURATION = 1000;

export const HIGHLIGHT_CLASS_NAME = 'blocktune-is-changed';

/**
 * The name of the CSS custom highlight that colors the changed text.
 */
export const TEXT_HIGHLIGHT_NAME = 'blocktune-changed-text';

/**
 * The custom property that fades out the changed text's color. The
 * CSS Custom Highlight API cannot animate, so the property is animated on
 * the block instead, which keeps the style changes inside the block.
 */
export const TEXT_OPACITY_PROPERTY = '--blocktune-changed-text-opacity';

type BlockState = {
	// The block editor replaces a block's attributes object only when they
	// change, so comparing them tells which blocks an edit changed.
	attributes: unknown;
	// The block's parent and place in it, to find the block that took its
	// place when it is replaced.
	parent: string;
	index: number;
	// The block's text in the canvas, if it is rendered.
	text: string | null;
	// Whether the block is the one selected block. The block editor scrolls
	// to a block when it becomes selected.
	selected: boolean;
};

/**
 * Each block's state, by client ID, in document order.
 */
export type BlockSnapshot = ReadonlyMap< string, BlockState >;

// Each highlighted block, with a number that changes each time it is
// highlighted again.
let highlighted: ReadonlyMap< string, number > = new Map();
let generation = 0;
// The block to scroll to once it renders, if it is off-screen.
let scrollTarget: string | null = null;
const listeners = new Set< () => void >();
const timers = new Map< string, ReturnType< typeof setTimeout > >();
// The text of each highlighted block before the edit.
const previousTexts = new Map< string, string >();
// The changed text of each highlighted block, and the windows whose
// highlight registry holds some of it.
const textRanges = new Map< string, Range >();
let paintedViews = new Set< Window >();
// The fade of the changed text's color in each block.
const fades = new WeakMap< Element, Animation >();

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

/**
 * Takes a snapshot of the blocks in the editor, to compare with after an
 * edit.
 *
 * @param withText Whether to read each block's text in the canvas.
 * @return The snapshot.
 */
export function takeBlockSnapshot( withText = true ): BlockSnapshot {
	const { getBlockOrder, getBlockAttributes, getSelectedBlockClientId } =
		select( blockEditorStore );
	const selected = getSelectedBlockClientId();
	const snapshot = new Map< string, BlockState >();
	const walk = ( parent: string ) => {
		getBlockOrder( parent ).forEach( ( clientId, index ) => {
			snapshot.set( clientId, {
				attributes: getBlockAttributes( clientId ),
				parent,
				index,
				text: withText ? ( getBlockElement( clientId )?.textContent ?? null ) : null,
				selected: clientId === selected,
			} );
			walk( clientId );
		} );
	};
	walk( '' );
	return snapshot;
}

/**
 * Finds the blocks that are new, or whose attributes changed, since the
 * snapshot. A changed block's inner blocks are left out, since its
 * highlight covers them.
 *
 * @param before The snapshot taken before the edit.
 * @return The client IDs of the changed blocks, in document order.
 */
export function findChangedBlocks( before: BlockSnapshot ): string[] {
	const { getBlockParents } = select( blockEditorStore );
	const after = takeBlockSnapshot( false );
	const changed = new Set(
		[ ...after.keys() ].filter(
			( clientId ) =>
				! before.has( clientId ) ||
				before.get( clientId )?.attributes !== after.get( clientId )?.attributes
		)
	);
	return [ ...changed ].filter(
		( clientId ) => ! getBlockParents( clientId ).some( ( parent ) => changed.has( parent ) )
	);
}

/**
 * Finds the text of each changed block before the edit. A block that took
 * the place of another one is compared with the one it replaced.
 *
 * @param before    The snapshot taken before the edit.
 * @param clientIds The changed blocks' client IDs.
 * @return The text of each block whose text, or the one of the block it
 *         replaced, was rendered, by client ID.
 */
function findPreviousTexts( before: BlockSnapshot, clientIds: string[] ): Map< string, string > {
	const { getBlock, getBlockIndex, getBlockRootClientId } = select( blockEditorStore );
	// The text of each removed block, by its place, to look up the block
	// that took its place without going through the snapshot each time.
	let removed: Map< string, string | null > | undefined;
	const texts = new Map< string, string >();
	for ( const clientId of clientIds ) {
		let text = before.get( clientId )?.text;
		if ( text === undefined ) {
			if ( ! removed ) {
				removed = new Map();
				for ( const [ id, old ] of before ) {
					const place = `${ old.parent }:${ old.index }`;
					if ( ! removed.has( place ) && ! getBlock( id ) ) {
						removed.set( place, old.text );
					}
				}
			}
			const parent = getBlockRootClientId( clientId ) ?? '';
			text = removed.get( `${ parent }:${ getBlockIndex( clientId ) }` );
		}
		if ( text !== undefined && text !== null ) {
			texts.set( clientId, text );
		}
	}
	return texts;
}

/**
 * Finds the part of the text that changed, from the first character that
 * differs to the last one.
 *
 * @param before The text before the change.
 * @param after  The text after the change.
 * @return The start and end of the changed part in the new text, or null
 *         when no text was added or changed.
 */
export function diffText( before: string, after: string ): { start: number; end: number } | null {
	const length = Math.min( before.length, after.length );
	let start = 0;
	while ( start < length && before[ start ] === after[ start ] ) {
		start++;
	}
	let suffix = 0;
	while (
		suffix < length - start &&
		before[ before.length - 1 - suffix ] === after[ after.length - 1 - suffix ]
	) {
		suffix++;
	}
	let end = after.length - suffix;
	// Keep characters made of two code units whole: a high surrogate starts one.
	const startCode = after.charCodeAt( start - 1 );
	if ( start > 0 && startCode >= 0xd800 && startCode <= 0xdbff ) {
		start--;
	}
	const endCode = after.charCodeAt( end - 1 );
	if ( end < after.length && endCode >= 0xd800 && endCode <= 0xdbff ) {
		end++;
	}
	return start < end ? { start, end } : null;
}

/**
 * Creates a range over the element's text, between two character offsets.
 *
 * @param element The element.
 * @param start   The offset of the first character.
 * @param end     The offset after the last character.
 * @return The range, or null when the offsets are past the text.
 */
export function createTextRange( element: Element, start: number, end: number ): Range | null {
	const document = element.ownerDocument;
	const walker = document.createTreeWalker( element, NodeFilter.SHOW_TEXT );
	const range = document.createRange();
	let offset = 0;
	let hasStart = false;
	for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
		const length = node.nodeValue?.length ?? 0;
		if ( ! hasStart && start < offset + length ) {
			range.setStart( node, start - offset );
			hasStart = true;
		}
		if ( hasStart && end <= offset + length ) {
			range.setEnd( node, end - offset );
			return range;
		}
		offset += length;
	}
	return null;
}

/**
 * Colors the text that changed in each highlighted block, in each window
 * that shows some of it.
 */
function paintTextHighlight() {
	const rangesByView = new Map< Window, Range[] >();
	for ( const range of textRanges.values() ) {
		const view = range.startContainer.ownerDocument?.defaultView;
		if ( view ) {
			rangesByView.set( view, [ ...( rangesByView.get( view ) ?? [] ), range ] );
		}
	}
	for ( const view of new Set( [ ...paintedViews, ...rangesByView.keys() ] ) ) {
		const { CSS: css, Highlight: CustomHighlight } = view as Window & typeof globalThis;
		if ( ! css?.highlights || ! CustomHighlight ) {
			continue;
		}
		const ranges = rangesByView.get( view );
		if ( ranges ) {
			css.highlights.set( TEXT_HIGHLIGHT_NAME, new CustomHighlight( ...ranges ) );
		} else {
			css.highlights.delete( TEXT_HIGHLIGHT_NAME );
		}
	}
	paintedViews = new Set( rangesByView.keys() );
}

/**
 * Colors the text that changed in the block.
 *
 * @param clientId The block's client ID.
 * @return Whether some text was colored.
 */
function highlightText( clientId: string ): boolean {
	const previous = previousTexts.get( clientId );
	const element = getBlockElement( clientId );
	// Browsers without the CSS Custom Highlight API show the block
	// highlight instead.
	const view = element?.ownerDocument.defaultView;
	if ( previous === undefined || ! element || ! view ) {
		return false;
	}
	const { CSS: css, Highlight: CustomHighlight } = view as Window & typeof globalThis;
	if ( ! css?.highlights || ! CustomHighlight ) {
		return false;
	}
	const changed = diffText( previous, element.textContent ?? '' );
	const range = changed && createTextRange( element, changed.start, changed.end );
	if ( ! range ) {
		return false;
	}
	textRanges.set( clientId, range );
	paintTextHighlight();
	fadeTextHighlight( element );
	return true;
}

/**
 * Fades out the changed text's color in the block, from the start. With
 * reduced motion, the color stays the same until the highlight ends.
 *
 * @param element The block's element.
 */
function fadeTextHighlight( element: HTMLElement ) {
	fades.get( element )?.cancel();
	fades.delete( element );
	const view = element.ownerDocument.defaultView;
	if ( ! element.animate || view?.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {
		return;
	}
	// The same as the block highlight's animation: it holds, then fades out.
	fades.set(
		element,
		element.animate(
			[
				{ [ TEXT_OPACITY_PROPERTY ]: 1 },
				{ [ TEXT_OPACITY_PROPERTY ]: 1, offset: 0.6 },
				{ [ TEXT_OPACITY_PROPERTY ]: 0 },
			],
			{ duration: HIGHLIGHT_DURATION }
		)
	);
}

/**
 * Highlights the blocks for a few seconds, and scrolls to the first one
 * when it is off-screen. A block highlighted again stays highlighted for
 * the full time from now.
 *
 * @param clientIds      The blocks to highlight, in document order.
 * @param texts          The text of the blocks before the edit, by client ID,
 *                       to color the text that changed.
 * @param options        Options.
 * @param options.scroll Whether to scroll to the first block. Without it,
 *                       the view stays where it is.
 */
export function highlightBlocks(
	clientIds: string[],
	texts: ReadonlyMap< string, string > = new Map(),
	{ scroll = true }: { scroll?: boolean } = {}
) {
	if ( ! clientIds.length ) {
		return;
	}
	generation++;
	const next = new Map( highlighted );
	for ( const clientId of clientIds ) {
		next.set( clientId, generation );
		const text = texts.get( clientId );
		if ( text === undefined ) {
			previousTexts.delete( clientId );
		} else {
			previousTexts.set( clientId, text );
		}
		clearTimeout( timers.get( clientId ) );
		timers.set(
			clientId,
			setTimeout( () => {
				timers.delete( clientId );
				previousTexts.delete( clientId );
				const rest = new Map( highlighted );
				rest.delete( clientId );
				highlighted = rest;
				listeners.forEach( ( listener ) => listener() );
			}, HIGHLIGHT_DURATION )
		);
	}
	scrollTarget = scroll ? clientIds[ 0 ] : null;
	highlighted = next;
	listeners.forEach( ( listener ) => listener() );
}

/**
 * Highlights the blocks and the text that changed since the snapshot, and
 * announces the change to screen readers.
 *
 * When the edit selected another block, such as the blocks that replaced
 * the selected ones, the block editor scrolls to that block itself, so the
 * view is left to it.
 *
 * @param before The snapshot taken before the edit.
 */
export function highlightChanges( before: BlockSnapshot ) {
	const clientIds = findChangedBlocks( before );
	if ( ! clientIds.length ) {
		announceRemoved( before );
		return;
	}
	const selected = select( blockEditorStore ).getSelectedBlockClientId();
	const isNewlySelected = !! selected && ! before.get( selected )?.selected;
	highlightBlocks( clientIds, findPreviousTexts( before, clientIds ), {
		scroll: ! isNewlySelected,
	} );
	speak(
		sprintf(
			/* translators: %d: The number of blocks. */
			_n( 'The AI changed %d block.', 'The AI changed %d blocks.', clientIds.length, 'blocktune' ),
			clientIds.length
		)
	);
}

/**
 * Announces the blocks that were removed since the snapshot, when an edit
 * only removed blocks and there is nothing to highlight. A removed block's
 * inner blocks are not counted.
 *
 * @param before The snapshot taken before the edit.
 */
function announceRemoved( before: BlockSnapshot ) {
	const { getBlock } = select( blockEditorStore );
	const removed = new Set( [ ...before.keys() ].filter( ( clientId ) => ! getBlock( clientId ) ) );
	const count = [ ...removed ].filter(
		( clientId ) => ! removed.has( before.get( clientId )?.parent ?? '' )
	).length;
	if ( ! count ) {
		return;
	}
	speak(
		sprintf(
			/* translators: %d: The number of blocks. */
			_n( 'The AI removed %d block.', 'The AI removed %d blocks.', count, 'blocktune' ),
			count
		)
	);
}

/**
 * Finds the block's element in the editor canvas iframe.
 *
 * @param clientId The block's client ID.
 * @return The element, if the block is rendered.
 */
function getBlockElement( clientId: string ): HTMLElement | null {
	const canvas = document.querySelector< HTMLIFrameElement >( 'iframe[name="editor-canvas"]' );
	return canvas?.contentDocument?.getElementById( `block-${ clientId }` ) ?? null;
}

/**
 * Scrolls to the block when it is off-screen, as the block editor scrolls
 * to a block that becomes selected: smoothly, or at once with reduced
 * motion.
 *
 * @param clientId The block's client ID.
 * @return Stops waiting to scroll.
 */
function scrollIntoViewIfNeeded( clientId: string ): () => void {
	const element = getBlockElement( clientId );
	const view = element?.ownerDocument.defaultView as ( Window & typeof globalThis ) | null;
	if ( ! element || ! view?.IntersectionObserver ) {
		return () => {};
	}
	const observer = new view.IntersectionObserver( ( [ entry ] ) => {
		// The first report tells whether the block is visible now.
		observer.disconnect();
		if ( entry && ! entry.isIntersecting ) {
			const reduceMotion = view.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
			element.scrollIntoView( {
				block: 'center',
				behavior: reduceMotion ? 'instant' : 'smooth',
			} );
		}
	} );
	observer.observe( element );
	return () => observer.disconnect();
}

type BlockListBlockProps = {
	clientId: string;
	className?: string;
};

/**
 * Colors the changed text of the changed blocks. A block whose changed text
 * cannot be found, such as a new block, gets the highlight class instead.
 *
 * @param BlockListBlock The block's component in the editor.
 * @return The component with the highlight.
 */
export function withChangeHighlight< P extends BlockListBlockProps >(
	BlockListBlock: ( props: P ) => unknown
) {
	return function ChangeHighlight( props: P ) {
		const { clientId, className } = props;
		const [ hasNoText, setHasNoText ] = useState( false );
		const changedAt = useSyncExternalStore( subscribe, () => highlighted.get( clientId ) ?? 0 );

		useEffect( () => {
			if ( ! changedAt ) {
				return;
			}
			let stopScroll = () => {};
			// Wait for the canvas to lay out the new block.
			const frame = window.requestAnimationFrame( () => {
				if ( scrollTarget === clientId ) {
					scrollTarget = null;
					stopScroll = scrollIntoViewIfNeeded( clientId );
				}
				setHasNoText( ! highlightText( clientId ) );
			} );
			return () => {
				window.cancelAnimationFrame( frame );
				stopScroll();
				if ( textRanges.delete( clientId ) ) {
					paintTextHighlight();
				}
				setHasNoText( false );
			};
		}, [ changedAt, clientId ] );

		return createElement( BlockListBlock as ( props: P ) => null, {
			...props,
			className:
				changedAt && hasNoText
					? [ className, HIGHLIGHT_CLASS_NAME ].filter( Boolean ).join( ' ' )
					: className,
		} );
	};
}

/**
 * Registers the highlight of changed blocks in the editor.
 */
export function registerChangeHighlight() {
	addFilter( 'editor.BlockListBlock', 'blocktune/change-highlight', withChangeHighlight );
}

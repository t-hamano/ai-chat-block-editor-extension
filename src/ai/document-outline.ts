/**
 * Internal dependencies
 */
import type { AiRead, AiReadResult } from '../platform';
import { BLOCK_TOKEN, REF_COMMENT } from './markup-tokens';

/**
 * Above this many characters of block markup, about 20k tokens, the model
 * gets an outline of the document instead of the whole of it, and reads the
 * blocks it needs with its read tools.
 */
export const LONG_DOCUMENT = 60000;

/**
 * How much of a block's text the outline shows.
 */
const LEADING_TEXT = 80;

/**
 * How many characters the outline has at most, about 10k tokens. A longer
 * outline shows less of each block's text, and then only the top-level
 * blocks.
 */
export const OUTLINE_LENGTH = 30000;

/**
 * How the outline is shortened, step by step, until it fits: how much of
 * each block's text it shows, and whether it lists nested blocks.
 */
const OUTLINE_STEPS = [
	{ leadingText: LEADING_TEXT, withNested: true },
	{ leadingText: 40, withNested: true },
	{ leadingText: 0, withNested: true },
	{ leadingText: 0, withNested: false },
];

/**
 * How many blocks around the selection, on each side, are sent with the
 * outline, and how much of their markup at most.
 */
const NEARBY_BLOCKS = 2;
const NEARBY_LENGTH = 8000;

/**
 * How many blocks a search returns at most.
 */
const MAX_FOUND = 30;

/**
 * A block of the document, as the outline lists it.
 */
export type OutlineBlock = {
	/**
	 * The reference ID, or an empty string when the block has none.
	 */
	ref: string;
	name: string;
	depth: number;
	/**
	 * Where the block's markup starts, with its reference ID, and ends.
	 */
	start: number;
	end: number;
	/**
	 * The block's own text, without that of its nested blocks.
	 */
	text: string;
	parent: OutlineBlock | null;
	children: OutlineBlock[];
};

/**
 * Matches the tags of elements that separate text, such as paragraphs,
 * list items, table cells, and line breaks. Other tags, such as `<strong>`,
 * are inside the text, so they are removed without a space.
 */
const SEPARATING_TAG =
	/<\/?(?:p|div|h[1-6]|li|ul|ol|dl|dt|dd|blockquote|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|pre|section|header|footer|aside|nav|article|details|summary|br|hr|img)\b[^>]*>/gi;

const ENTITIES: Record< string, string > = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

/**
 * Turns markup into plain text: without tags, with common entities decoded,
 * and with whitespace collapsed.
 *
 * @param markup The markup.
 * @return The text.
 */
function toText( markup: string ): string {
	return markup
		.replace( /<!--[\s\S]*?-->/g, ' ' )
		.replace( SEPARATING_TAG, ' ' )
		.replace( /<[^>]*>/g, '' )
		.replace( /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, ( entity, code: string ) => {
			if ( code[ 0 ] === '#' ) {
				const point =
					code[ 1 ].toLowerCase() === 'x'
						? parseInt( code.slice( 2 ), 16 )
						: parseInt( code.slice( 1 ), 10 );
				return point > 0 && point <= 0x10ffff ? String.fromCodePoint( point ) : entity;
			}
			return ENTITIES[ code.toLowerCase() ] ?? entity;
		} )
		.replace( /\s+/g, ' ' )
		.trim();
}

/**
 * Lists the blocks of the document, nested ones included, in order.
 *
 * @param document The document, with reference IDs.
 * @return The blocks.
 */
export function parseOutline( document: string ): OutlineBlock[] {
	const blocks: OutlineBlock[] = [];
	const stack: OutlineBlock[] = [];
	const texts = new Map< OutlineBlock, string[] >();
	let pending: { ref: string; start: number } | null = null;
	let end = 0;
	for ( const match of document.matchAll( BLOCK_TOKEN ) ) {
		const [ token, ref, isCloser, name, isSelfClosing ] = match;
		const parent = stack[ stack.length - 1 ];
		if ( parent ) {
			texts.get( parent )?.push( document.slice( end, match.index ) );
		}
		end = match.index + token.length;
		if ( ref ) {
			pending = { ref: ref.toLowerCase(), start: match.index };
			continue;
		}
		if ( isCloser ) {
			const closed = stack.pop();
			if ( closed ) {
				closed.end = end;
			}
			pending = null;
			continue;
		}
		const block: OutlineBlock = {
			ref: pending?.ref ?? '',
			name: name.includes( '/' ) ? name.toLowerCase() : `core/${ name.toLowerCase() }`,
			depth: stack.length,
			start: pending?.start ?? match.index,
			end,
			text: '',
			parent: parent ?? null,
			children: [],
		};
		pending = null;
		blocks.push( block );
		parent?.children.push( block );
		if ( ! isSelfClosing ) {
			texts.set( block, [] );
			stack.push( block );
		}
	}
	texts.forEach( ( parts, block ) => {
		block.text = toText( parts.join( ' ' ) );
	} );
	return blocks;
}

/**
 * Describes a block in one line: its reference ID, name, and leading text.
 *
 * @param block       The block.
 * @param indent      Whether to indent the line by the block's depth.
 * @param leadingText How much of the block's text to show.
 * @return The line.
 */
function describeBlock( block: OutlineBlock, indent = true, leadingText = LEADING_TEXT ): string {
	const text =
		block.text.length > leadingText
			? `${ block.text.slice( 0, leadingText ).trimEnd() }…`
			: block.text;
	return [
		indent ? '  '.repeat( block.depth ) : '',
		block.ref || '-',
		' ',
		block.name,
		text && leadingText ? `: ${ text }` : '',
	].join( '' );
}

/**
 * Lists the blocks in lines, shortened step by step until the list fits in
 * the outline: with less of each block's text, and then with only the
 * top-level blocks, each saying how many nested blocks it has.
 *
 * @param blocks The blocks of the document.
 * @return The lines.
 */
function describeOutline( blocks: OutlineBlock[] ): string {
	let lines = '';
	for ( const { leadingText, withNested } of OUTLINE_STEPS ) {
		lines = blocks
			.filter( ( block ) => withNested || block.depth === 0 )
			.map( ( block ) => {
				const line = describeBlock( block, true, leadingText );
				const nested = withNested ? 0 : flatten( block ).length - 1;
				return nested ? `${ line } (${ nested } nested blocks)` : line;
			} )
			.join( '\n' );
		if ( lines.length <= OUTLINE_LENGTH ) {
			break;
		}
	}
	return lines;
}

/**
 * Lists a block and its nested blocks.
 *
 * @param block The block.
 * @return The block, and its nested blocks after it.
 */
function flatten( block: OutlineBlock ): OutlineBlock[] {
	return [ block, ...block.children.flatMap( flatten ) ];
}

/**
 * Finds the blocks next to the selected ones, at the same level.
 *
 * @param blocks       The blocks of the document.
 * @param document     The document.
 * @param refs         The reference IDs in the selection.
 * @param withSelected Whether the selected blocks come too, in their place.
 * @return The markup of the blocks before and after the selection.
 */
function findNearby(
	blocks: OutlineBlock[],
	document: string,
	refs: Set< string >,
	withSelected: boolean
): string[] {
	const selected = blocks.filter( ( block ) => refs.has( block.ref ) );
	const first = selected[ 0 ];
	if ( ! first ) {
		return [];
	}
	const siblings = first.parent
		? first.parent.children
		: blocks.filter( ( block ) => block.depth === 0 );
	const last = [ ...selected ].reverse().find( ( block ) => siblings.includes( block ) ) ?? first;
	const from = siblings.indexOf( first );
	const to = siblings.indexOf( last );
	const nearby = [
		...siblings.slice( Math.max( 0, from - NEARBY_BLOCKS ), from ),
		...( withSelected ? siblings.slice( from, to + 1 ) : [] ),
		...siblings.slice( to + 1, to + 1 + NEARBY_BLOCKS ),
	];
	let length = 0;
	return nearby
		.map( ( block ) => document.slice( block.start, block.end ) )
		.filter( ( markup ) => {
			length += markup.length;
			return length <= NEARBY_LENGTH;
		} );
}

/**
 * Tells whether the document is sent as an outline: when it is long, and
 * all its content is in blocks with reference IDs. Content outside them,
 * such as a classic block, would be missing from the outline, so such a
 * document is sent as a whole.
 *
 * @param document The document, with reference IDs.
 * @return Whether to send the outline.
 */
export function isLongDocument( document: string ): boolean {
	if ( document.length <= LONG_DOCUMENT ) {
		return false;
	}
	let rest = '';
	let end = 0;
	for ( const block of parseOutline( document ) ) {
		if ( block.depth === 0 ) {
			rest += document.slice( end, block.start );
			end = block.end;
			if ( ! block.ref ) {
				return false;
			}
		}
	}
	rest += document.slice( end );
	return ! rest.trim();
}

/**
 * Shows a long document as an outline: each block in a line with its
 * reference ID, name, and leading text, nested blocks indented under their
 * parent. A very long outline is shortened, as `describeOutline` tells.
 * The blocks around the selection follow as block markup. When
 * the selection is text inside a block, that block comes with them, since
 * the selection has only the text.
 *
 * @param document  The document, with reference IDs.
 * @param selection The selection, with reference IDs.
 * @param textIn    The reference ID of the block when the selection is
 *                  text inside it.
 * @return The `<outline>` block, and the `<nearby>` block when there are
 *         blocks around the selection.
 */
export function formatOutline( document: string, selection: string, textIn?: string ): string {
	const blocks = parseOutline( document );
	const refs = new Set(
		textIn
			? [ textIn.toLowerCase() ]
			: [ ...selection.matchAll( REF_COMMENT ) ].map( ( match ) => match[ 1 ].toLowerCase() )
	);
	const parts = [ [ '<outline>', describeOutline( blocks ), '</outline>' ].join( '\n' ) ];
	const nearby = findNearby( blocks, document, refs, !! textIn );
	if ( nearby.length ) {
		parts.push( [ '<nearby>', ...nearby, '</nearby>' ].join( '\n' ) );
	}
	return parts.join( '\n\n' );
}

/**
 * Returns the markup of the blocks with the reference IDs. A block too
 * long to read at once is shown as an outline, so its nested blocks can be
 * read one by one.
 *
 * @param document The document, with reference IDs.
 * @param refs     The reference IDs.
 * @return What was found.
 */
function readBlocks( document: string, refs: string[] ): AiReadResult {
	const blocks = parseOutline( document );
	const missing: string[] = [];
	const parts: string[] = [];
	for ( const ref of refs ) {
		const block = blocks.find( ( { ref: id } ) => id && id === ref.trim().toLowerCase() );
		if ( ! block ) {
			missing.push( ref );
			continue;
		}
		const markup = document.slice( block.start, block.end );
		// A block without nested blocks can only be read as a whole.
		if ( markup.length <= LONG_DOCUMENT || ! block.children.length ) {
			parts.push( markup );
			continue;
		}
		// Its own markup, with each nested block replaced by a comment that
		// names it, so its own attributes and content can be read.
		let ownMarkup = '';
		let end = block.start;
		for ( const child of block.children ) {
			ownMarkup += `${ document.slice( end, child.start ) }<!-- nested block ${ child.ref || child.name } -->`;
			end = child.end;
		}
		ownMarkup += document.slice( end, block.end );
		parts.push(
			[
				`Block ${ block.ref } is too long to read at once. This is its own markup, with each nested block in a <!-- nested block ... --> comment, and the outline of its nested blocks after it. Read the nested blocks separately.`,
				ownMarkup,
				flatten( block )
					.slice( 1 )
					.map( ( child ) => describeBlock( child ) )
					.join( '\n' ),
			].join( '\n' )
		);
	}
	const note = missing.length
		? `No block in the document now has the reference ID ${ missing.join( ', ' ) }.`
		: '';
	if ( ! parts.length ) {
		return { status: 'failed', reason: note };
	}
	return { status: 'done', content: [ ...parts, note ].filter( Boolean ).join( '\n\n' ) };
}

/**
 * Lists the blocks whose own text has the query, ignoring case.
 *
 * @param document The document, with reference IDs.
 * @param query    The text to search for.
 * @return What was found.
 */
function findBlocks( document: string, query: string ): AiReadResult {
	const needle = query.toLowerCase();
	const found = parseOutline( document ).filter(
		( block ) => block.ref && block.text.toLowerCase().includes( needle )
	);
	if ( ! found.length ) {
		return { status: 'done', content: `No block has the text "${ query }".` };
	}
	const lines = found.slice( 0, MAX_FOUND ).map( ( block ) => describeBlock( block, false ) );
	if ( found.length > MAX_FOUND ) {
		lines.push(
			`…and ${ found.length - MAX_FOUND } more blocks. Search for longer text to narrow them down.`
		);
	}
	return { status: 'done', content: lines.join( '\n' ) };
}

/**
 * Answers the model's request to read the document.
 *
 * @param document The document as it is now, with reference IDs.
 * @param read     The request.
 * @return What was found.
 */
export function readDocument( document: string, read: AiRead ): AiReadResult {
	return read.tool === 'read_blocks'
		? readBlocks( document, read.refs )
		: findBlocks( document, read.query );
}

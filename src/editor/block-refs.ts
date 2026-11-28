/**
 * WordPress dependencies
 */
import { getFreeformContentHandlerName, serialize, type Block } from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import { REF_COMMENT } from '../ai/markup-tokens';

// The reference IDs of the blocks, kept for the editor session so that a
// block keeps its ID through the conversation, and after undo.
const refs = new Map< string, string >();
const clientIds = new Map< string, string >();

/**
 * Returns the reference ID of a block, and gives it one when it has none.
 *
 * @param clientId The block's client ID.
 * @return The reference ID, such as `b12`.
 */
export function getRef( clientId: string ): string {
	let ref = refs.get( clientId );
	if ( ! ref ) {
		ref = `b${ refs.size + 1 }`;
		refs.set( clientId, ref );
		clientIds.set( ref, clientId );
	}
	return ref;
}

/**
 * Finds the block a reference ID points at.
 *
 * @param ref The reference ID.
 * @return The block's client ID, or `undefined` when no block has the ID.
 */
export function getClientIdByRef( ref: string ): string | undefined {
	return clientIds.get( ref.trim().toLowerCase() );
}

/**
 * Removes the reference IDs from markup the model wrote. They only point
 * at blocks, and are not part of the content.
 *
 * @param markup The markup.
 * @return The markup without reference IDs.
 */
export function stripRefs( markup: string ): string {
	return markup.replace( REF_COMMENT, '' );
}

/**
 * Puts a reference ID before the block, and before each of its inner blocks.
 *
 * Each inner block is serialized on its own, and found in the markup of its
 * parent. When it is not there, as in an invalid block saved as it was
 * written, it gets no ID.
 *
 * @param block  The block.
 * @param markup The block's markup.
 * @return The block's markup with reference IDs.
 */
function addRefs( block: Block, markup: string ): string {
	// A classic block is saved without delimiters at the top level, so it
	// gets no ID, nested or not.
	const ref =
		block.name === getFreeformContentHandlerName() ? '' : `<!-- ${ getRef( block.clientId ) } -->`;
	const parts = [ ref ];
	let cursor = 0;
	block.innerBlocks.forEach( ( innerBlock ) => {
		const innerMarkup = serialize( innerBlock, { isInnerBlocks: true } );
		const index = markup.indexOf( innerMarkup, cursor );
		if ( index === -1 ) {
			return;
		}
		parts.push( markup.slice( cursor, index ), addRefs( innerBlock, innerMarkup ) );
		cursor = index + innerMarkup.length;
	} );
	parts.push( markup.slice( cursor ) );
	return parts.join( '' );
}

/**
 * Serializes the blocks with a reference ID before the opening delimiter
 * of each block, including nested ones.
 *
 * @param blocks The blocks.
 * @return The block markup with reference IDs.
 */
export function serializeWithRefs( blocks: Block[] ): string {
	// The same as `serialize()`, which joins the blocks with a blank line.
	return blocks.map( ( block ) => addRefs( block, serialize( block ) ) ).join( '\n\n' );
}

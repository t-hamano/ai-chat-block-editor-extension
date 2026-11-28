/**
 * WordPress dependencies
 */
import type { Block } from '@wordpress/blocks';
import { getBlockType } from '@wordpress/blocks';

/**
 * Attributes the AI never changes: they lock blocks, and hold the block's
 * name, bindings, and visibility.
 */
const PROTECTED_ATTRIBUTES = [ 'lock', 'templateLock', 'metadata' ];

/**
 * Whether two attribute values are the same, whatever the order of their
 * keys.
 *
 * @param a A value.
 * @param b Another value.
 * @return Whether they are the same.
 */
export function isEqual( a: unknown, b: unknown ): boolean {
	if ( a === b ) {
		return true;
	}
	if ( ! a || ! b || typeof a !== 'object' || typeof b !== 'object' ) {
		return false;
	}
	if ( Array.isArray( a ) !== Array.isArray( b ) ) {
		return false;
	}
	// Rich text values, which keep their HTML out of their keys.
	const isPlain = ( value: object ) =>
		Array.isArray( value ) || Object.getPrototypeOf( value ) === Object.prototype;
	if ( ! isPlain( a ) || ! isPlain( b ) ) {
		return String( a ) === String( b );
	}
	const aKeys = Object.keys( a ).filter(
		( key ) => ( a as Record< string, unknown > )[ key ] !== undefined
	);
	const bKeys = Object.keys( b ).filter(
		( key ) => ( b as Record< string, unknown > )[ key ] !== undefined
	);
	return (
		aKeys.length === bKeys.length &&
		aKeys.every( ( key ) =>
			isEqual(
				( a as Record< string, unknown > )[ key ],
				( b as Record< string, unknown > )[ key ]
			)
		)
	);
}

/**
 * Finds a protected attribute that a new block carries, other than its
 * default.
 *
 * @param block The new block.
 * @return The attribute's name, or `undefined`.
 */
function findCarried( block: Block ): string | undefined {
	const defaults = getBlockType( block.name )?.attributes ?? {};
	return PROTECTED_ATTRIBUTES.find(
		( key ) =>
			block.attributes[ key ] !== undefined &&
			! isEqual( block.attributes[ key ], defaults[ key ]?.default )
	);
}

/**
 * Explains a change of the protected attributes in an edit, if it makes
 * one. A block that has the name and the place of a block it replaces
 * keeps that block's protected attributes. A block without one is new,
 * and does not have them.
 *
 * @param before The blocks the edit replaces. None when it only inserts.
 * @param after  The blocks of the edit.
 * @return Why the edit cannot be applied, or `null`.
 */
export function findProtectedChange( before: Block[], after: Block[] ): string | null {
	for ( const [ index, block ] of after.entries() ) {
		const old = before[ index ]?.name === block.name ? before[ index ] : undefined;
		const changed = old
			? PROTECTED_ATTRIBUTES.find(
					( key ) => ! isEqual( old.attributes[ key ], block.attributes[ key ] )
				)
			: findCarried( block );
		if ( changed ) {
			return [
				old
					? `The edit changes the "${ changed }" attribute of a "${ block.name }" block.`
					: `The edit adds a "${ block.name }" block with the "${ changed }" attribute.`,
				'The "lock", "templateLock", and "metadata" attributes cannot be changed.',
				'Keep them as they are in the document, leave them out of new blocks, and try again.',
			].join( ' ' );
		}
		const inner = findProtectedChange( old?.innerBlocks ?? [], block.innerBlocks );
		if ( inner ) {
			return inner;
		}
	}
	return null;
}

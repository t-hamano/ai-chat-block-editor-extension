/**
 * External dependencies
 */
import isEqual from 'fast-deep-equal';

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
 * Whether a protected attribute is the same as in the markup the model
 * read. The value in the editor can hold keys set to `undefined`, which
 * the markup leaves out.
 *
 * @param value  The value in the editor.
 * @param parsed The value parsed from the model's markup.
 * @return Whether they are the same.
 */
function isSame( value: unknown, parsed: unknown ): boolean {
	return isEqual( value === undefined ? value : JSON.parse( JSON.stringify( value ) ), parsed );
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
			! isSame( defaults[ key ]?.default, block.attributes[ key ] )
	);
}

/**
 * Finds a protected attribute that differs between two blocks.
 *
 * @param old   The block in the editor.
 * @param block The block parsed from the model's markup.
 * @return The attribute's name, or `undefined`.
 */
function findChanged( old: Block, block: Block ): string | undefined {
	return PROTECTED_ATTRIBUTES.find(
		( key ) => ! isSame( old.attributes[ key ], block.attributes[ key ] )
	);
}

/**
 * Whether a block has the name and the protected attributes of a block in
 * the editor, so that it can take its place.
 *
 * @param old   The block in the editor.
 * @param block The block parsed from the model's markup.
 * @return Whether it can.
 */
export function isSameBlock( old: Block, block: Block ): boolean {
	return old.name === block.name && ! findChanged( old, block );
}

/**
 * Pairs each new block with a block it replaces that has its name and its
 * protected attributes, in order, so that blocks inserted or removed
 * around a block do not change what it is compared with. Blocks with
 * protected attributes are paired first, so that a block without them
 * does not take their place.
 *
 * @param before The blocks the edit replaces.
 * @param after  The blocks of the edit.
 * @return The block each new block replaces, if any.
 */
function pairBlocks( before: Block[], after: Block[] ): ( Block | undefined )[] {
	const pairs: ( Block | undefined )[] = after.map( () => undefined );
	const used = new Set< Block >();
	let next = 0;
	after.forEach( ( block, index ) => {
		if ( ! findCarried( block ) ) {
			return;
		}
		const found = before.findIndex(
			( old, oldIndex ) => oldIndex >= next && isSameBlock( old, block )
		);
		if ( found !== -1 ) {
			pairs[ index ] = before[ found ];
			used.add( before[ found ] );
			next = found + 1;
		}
	} );
	after.forEach( ( block, index ) => {
		if ( pairs[ index ] ) {
			return;
		}
		const old = before.find( ( item ) => ! used.has( item ) && isSameBlock( item, block ) );
		if ( old ) {
			pairs[ index ] = old;
			used.add( old );
		}
	} );
	return pairs;
}

const explain = ( reason: string ) =>
	[
		reason,
		'The "lock", "templateLock", and "metadata" attributes cannot be changed.',
		'Keep them as they are in the document, leave them out of new blocks, and try again.',
	].join( ' ' );

/**
 * Explains a change of the protected attributes in an edit, if it makes
 * one. A new block that has the name and the protected attributes of a
 * block it replaces takes its place. Other new blocks do not have
 * protected attributes, and do not take the place of a block that has
 * them. Removing such a block is not a change.
 *
 * @param before The blocks the edit replaces. None when it only inserts.
 * @param after  The blocks of the edit.
 * @return Why the edit cannot be applied, or `null`.
 */
export function findProtectedChange( before: Block[], after: Block[] ): string | null {
	const pairs = pairBlocks( before, after );
	const unpaired = after.filter( ( _, index ) => ! pairs[ index ] );
	for ( const old of before.filter(
		( item ) => ! pairs.includes( item ) && findCarried( item )
	) ) {
		const block = unpaired.find( ( item ) => item.name === old.name );
		if ( block ) {
			return explain(
				`The edit changes the "${ findChanged( old, block ) }" attribute of a "${ block.name }" block.`
			);
		}
	}
	for ( const [ index, block ] of after.entries() ) {
		const carried = pairs[ index ] ? undefined : findCarried( block );
		if ( carried ) {
			return explain(
				`The edit adds a "${ block.name }" block with the "${ carried }" attribute.`
			);
		}
		const inner = findProtectedChange( pairs[ index ]?.innerBlocks ?? [], block.innerBlocks );
		if ( inner ) {
			return inner;
		}
	}
	return null;
}

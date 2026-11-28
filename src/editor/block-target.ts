/**
 * External dependencies
 */
import isEqual from 'fast-deep-equal';

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import type { Block } from '@wordpress/blocks';
import { getBlockType, getFreeformContentHandlerName, serialize } from '@wordpress/blocks';
import { dispatch, select } from '@wordpress/data';

/**
 * Internal dependencies
 */
import type { EditTarget } from '../ai/edit-target';
import { findUniqueText } from '../ai/find-text';
import type { AiEdit, AiEditResult } from '../platform';
import { getClientIdByRef, getRef, serializeWithRefs, stripRefs } from './block-refs';
import { locateText } from './locate-text';
import { findProtectedChange, isSameBlock } from './protected-attributes';
import { collectUnsafeHtml } from './unsafe-html';
import type { SeenBlocks } from './seen-blocks';
import { createSeenBlocks } from './seen-blocks';
import { collectHtml, validateMarkup } from './validate-markup';

/**
 * Whether the blocks, or their inner blocks, have a Classic block.
 *
 * @param blocks The blocks.
 * @return Whether they have one.
 */
function hasClassicBlock( blocks: Block[] ): boolean {
	const name = getFreeformContentHandlerName();
	return blocks.some( ( block ) => block.name === name || hasClassicBlock( block.innerBlocks ) );
}

function failed( reason: string ): AiEditResult {
	return { status: 'failed', reason };
}

/**
 * Whether new blocks have the names, the protected attributes, and the
 * inner blocks of the blocks they replace, so that only their other
 * attributes change.
 *
 * @param before The blocks in the editor.
 * @param after  The new blocks.
 * @return Whether the structure is the same.
 */
function hasSameStructure( before: Block[], after: Block[] ): boolean {
	return (
		before.length === after.length &&
		before.every(
			( block, index ) =>
				block.isValid !== false &&
				isSameBlock( block, after[ index ] ) &&
				hasSameStructure( block.innerBlocks, after[ index ].innerBlocks )
		)
	);
}

/**
 * Collects the attributes that change from each block to the new block
 * in its place, with `undefined` for those the new block does not have.
 *
 * @param before  The blocks in the editor.
 * @param after   The new blocks, with the same structure.
 * @param changes The changes by client ID, which this adds to.
 * @return The changes.
 */
function collectAttributeChanges(
	before: Block[],
	after: Block[],
	changes: Record< string, Record< string, unknown > > = {}
): Record< string, Record< string, unknown > > {
	before.forEach( ( block, index ) => {
		const next = after[ index ];
		const keys = new Set( [
			...Object.keys( block.attributes ),
			...Object.keys( next.attributes ),
		] );
		const changed = [ ...keys ].filter(
			( key ) => ! isEqual( block.attributes[ key ], next.attributes[ key ] )
		);
		if ( changed.length ) {
			changes[ block.clientId ] = Object.fromEntries(
				changed.map( ( key ) => [ key, next.attributes[ key ] ] )
			);
		}
		collectAttributeChanges( block.innerBlocks, next.innerBlocks, changes );
	} );
	return changes;
}

/**
 * Creates the edit target for the blocks selected now. Blocks anywhere in
 * the document can also be edited by their reference IDs, which the
 * document and the selection carry before each block.
 *
 * Each edit is one undo step.
 *
 * @param seen The blocks as the model saw them, when another target shares
 *             them.
 * @return The edit target.
 */
export function createBlockTarget( seen: SeenBlocks = createSeenBlocks() ): EditTarget {
	const editor = () => select( blockEditorStore );
	// The blocks the edits are for. A replacement takes their place.
	let clientIds = editor().getSelectedBlockClientIds();
	// The block `insert_after` inserts after: the end of the selection, or
	// the blocks inserted before, so that they stay in order.
	let anchor: string | undefined = clientIds[ clientIds.length - 1 ];

	const getDocument = () => serializeWithRefs( editor().getBlocks() );
	// What the automatic fix changed in the markup of the edit being applied.
	let autoFix: string | undefined;

	/**
	 * Validates the markup, and returns its blocks or why they cannot be
	 * applied.
	 *
	 * When the markup was fixed automatically, what changed is kept for the
	 * result of the edit.
	 *
	 * @param markup The model's markup.
	 * @return The blocks, or the reason.
	 */
	function readBlocks( markup: string ): Block[] | string {
		autoFix = undefined;
		// Markup that the editor would not read as written is never applied.
		const {
			blocks,
			problems,
			autoFix: fix,
		} = validateMarkup(
			stripRefs( markup ),
			collectHtml( editor().getBlocks() ),
			collectUnsafeHtml( editor().getBlocks() )
		);
		if ( problems.length ) {
			return [
				'The edit was not applied, because the markup has these problems:',
				...problems.map( ( problem ) => `- ${ problem }` ),
				'Fix the markup, and call edit_blocks again.',
			].join( '\n' );
		}
		if ( ! blocks.length ) {
			return 'The markup has no blocks. Write the content as block markup, and try again.';
		}
		autoFix = fix;
		return blocks;
	}

	/**
	 * Checks that the blocks can go where they are inserted, and that each
	 * of their inner blocks can go inside its parent.
	 *
	 * The store only checks blocks whose parent is already in the document,
	 * so the inner blocks are checked with the same rules from block.json.
	 *
	 * @param blocks       The new blocks.
	 * @param rootClientId The parent the blocks are inserted into.
	 * @return Why a block cannot be inserted, or `null`.
	 */
	function canInsert( blocks: Block[], rootClientId: string | undefined ): string | null {
		const { canInsertBlockType, getBlockName, getBlockParents } = editor();
		const rootName = rootClientId ? getBlockName( rootClientId ) : null;
		const notAllowed = blocks.find( ( block ) => ! canInsertBlockType( block.name, rootClientId ) );
		if ( notAllowed ) {
			return explainNotAllowed( notAllowed.name, rootName );
		}
		// The names of the blocks around the new blocks, nearest first.
		const ancestors = rootClientId
			? [ rootClientId, ...getBlockParents( rootClientId, true ) ]
					.map( ( id ) => getBlockName( id ) )
					.filter( ( name ) => name !== null )
			: [];
		for ( const block of blocks ) {
			const reason = canInsertInner( block, [ block.name, ...ancestors ] );
			if ( reason ) {
				return reason;
			}
		}
		return null;
	}

	/**
	 * Checks that each inner block of a new block can go inside it, with
	 * the rules the store uses for blocks in the document.
	 *
	 * @param block     The new block.
	 * @param ancestors The names of the block and the blocks around it, nearest first.
	 * @return Why an inner block cannot go inside its parent, or `null`.
	 */
	function canInsertInner( block: Block, ancestors: string[] ): string | null {
		const { allowedBlockTypes } = editor().getSettings();
		const parentType = getBlockType( block.name );
		// Blocks can also limit their inner blocks with an attribute.
		const parentAllowed: unknown = block.attributes.allowedBlocks ?? parentType?.allowedBlocks;
		for ( const inner of block.innerBlocks ) {
			const type = getBlockType( inner.name );
			const isAllowedType = Array.isArray( allowedBlockTypes )
				? allowedBlockTypes.includes( inner.name )
				: allowedBlockTypes !== false;
			const isAllowedByParent = Array.isArray( parentAllowed )
				? parentAllowed.includes( inner.name )
				: null;
			const isAllowedParent = type?.parent?.length ? type.parent.includes( block.name ) : null;
			const hasAllowedAncestor =
				! type?.ancestor?.length || ancestors.some( ( name ) => type.ancestor?.includes( name ) );
			const isAllowed =
				!! type &&
				isAllowedType &&
				hasAllowedAncestor &&
				( ( isAllowedByParent === null && isAllowedParent === null ) ||
					isAllowedByParent === true ||
					isAllowedParent === true );
			if ( ! isAllowed ) {
				return explainNotAllowed( inner.name, block.name, {
					isInner: true,
					allowedBlocks: parentAllowed,
				} );
			}
			const reason = canInsertInner( inner, [ inner.name, ...ancestors ] );
			if ( reason ) {
				return reason;
			}
		}
		return null;
	}

	/**
	 * Explains why a block cannot be inserted, with the rules for where it
	 * can go from its block.json and the block.json of the parent, so that
	 * the model can find a place it can go.
	 *
	 * @param name                  The name of the block.
	 * @param rootName              The name of the parent the block was inserted into.
	 * @param options               Options.
	 * @param options.isInner       Whether the block is an inner block of the new markup.
	 * @param options.allowedBlocks The blocks the parent accepts, when not those of its block.json.
	 * @return The explanation.
	 */
	function explainNotAllowed(
		name: string,
		rootName: string | null,
		{
			isInner = false,
			allowedBlocks = rootName ? getBlockType( rootName )?.allowedBlocks : undefined,
		}: { isInner?: boolean; allowedBlocks?: unknown } = {}
	): string {
		const quote = ( names: string[] ) => names.map( ( item ) => `"${ item }"` ).join( ' or ' );
		const reasons = [
			isInner
				? `The "${ name }" block is not allowed inside the "${ rootName }" block.`
				: `The "${ name }" block is not allowed here.`,
		];
		const { parent, ancestor } = getBlockType( name ) ?? {};
		if ( parent?.length ) {
			reasons.push( `It can only be placed directly inside ${ quote( parent ) }.` );
		}
		if ( ancestor?.length ) {
			reasons.push( `It can only be placed somewhere inside ${ quote( ancestor ) }.` );
		}
		if (
			rootName &&
			Array.isArray( allowedBlocks ) &&
			allowedBlocks.length &&
			! allowedBlocks.includes( name )
		) {
			reasons.push(
				`The parent "${ rootName }" block only accepts ${ quote( allowedBlocks ) } inside it.`
			);
		}
		return reasons.join( ' ' );
	}

	function applied( blocks: Block[] ): AiEditResult {
		return {
			status: 'applied',
			refs: blocks.map( ( block ) => getRef( block.clientId ) ),
			...( autoFix && { autoFix } ),
		};
	}

	/**
	 * Applies new blocks with the structure of the blocks they replace by
	 * changing the attributes of those blocks, so that a block that cannot
	 * be removed can still be edited, as the user can edit it.
	 *
	 * @param before The blocks in the editor.
	 * @param after  The new blocks, with the same structure.
	 * @return What became of the edit.
	 */
	function updateInPlace( before: Block[], after: Block[] ): AiEditResult {
		const changes = collectAttributeChanges( before, after );
		const ids = Object.keys( changes );
		const locked = ids.find( ( clientId ) => ! editor().canEditBlock( clientId ) );
		if ( locked ) {
			return failed( `The block "${ getRef( locked ) }" is locked, so it cannot be edited.` );
		}
		if ( ids.length ) {
			// One action, so that the edit is one undo step.
			dispatch( blockEditorStore ).updateBlockAttributes( ids, changes, {
				uniqueByBlock: true,
			} );
		}
		return applied( before );
	}

	/**
	 * Fails when a block that an edit replaces with other blocks cannot be
	 * removed or edited.
	 *
	 * @param ids The client IDs of the blocks.
	 * @return Why the blocks cannot be replaced, or `null`.
	 */
	function checkReplaceable( ids: string[] ): AiEditResult | null {
		const { canEditBlock, canRemoveBlocks } = editor();
		if ( canRemoveBlocks( ids ) && ids.every( ( clientId ) => canEditBlock( clientId ) ) ) {
			return null;
		}
		const refs = ids.map( ( clientId ) => `"${ getRef( clientId ) }"` ).join( ', ' );
		return failed(
			`The blocks ${ refs } are locked, so they cannot be replaced with other blocks. Keep the same blocks and their inner blocks, and change only their content.`
		);
	}

	/**
	 * Fails when the user changed one of the blocks, or their inner blocks,
	 * since the model last saw them, so that the edit does not undo what the
	 * user changed.
	 *
	 * @param ids The client IDs of the blocks.
	 * @return Why the blocks cannot be edited now, or `null`.
	 */
	function checkUnchanged( ids: string[] ): AiEditResult | null {
		const changed = seen.findChanged( ids );
		if ( ! changed ) {
			return null;
		}
		const ref = getRef( changed );
		return failed(
			`The user changed the block "${ ref }" after you last read it, so the edit was not applied, to keep what the user changed. Read the block again with "read_blocks", and edit it from what it is now.`
		);
	}

	/**
	 * Applies an edit of the block a reference ID points at.
	 *
	 * @param edit The edit.
	 * @param ref  The block's reference ID.
	 * @return What became of the edit.
	 */
	function applyToRef( edit: AiEdit, ref: string ): AiEditResult {
		const { canRemoveBlocks, getBlock, getBlockIndex, getBlockRootClientId } = editor();
		const clientId = getClientIdByRef( ref );
		if ( ! clientId || ! getBlock( clientId ) ) {
			return failed(
				`There is no block with the reference ID "${ ref }" in the document. Use a reference ID from the latest document.`
			);
		}
		if ( edit.action === 'delete_block' || edit.action === 'replace_block' ) {
			const changed = checkUnchanged( [ clientId ] );
			if ( changed ) {
				return changed;
			}
		}
		if ( edit.action === 'delete_block' ) {
			if ( ! canRemoveBlocks( [ clientId ] ) ) {
				return failed( `The block "${ ref }" is locked, so it cannot be removed.` );
			}
			dispatch( blockEditorStore ).removeBlocks( [ clientId ], false );
			clientIds = clientIds.filter( ( id ) => id !== clientId );
			return { status: 'applied', refs: [] };
		}

		const blocks = readBlocks( edit.markup );
		if ( typeof blocks === 'string' ) {
			return failed( blocks );
		}
		const isReplace = edit.action === 'replace_block';
		const old = getBlock( clientId );
		const replaced = isReplace && old ? [ old ] : [];
		const protectedChange = findProtectedChange( replaced, blocks );
		if ( protectedChange ) {
			return failed( protectedChange );
		}
		if ( isReplace && hasSameStructure( replaced, blocks ) ) {
			return updateInPlace( replaced, blocks );
		}
		const notReplaceable = isReplace && checkReplaceable( [ clientId ] );
		if ( notReplaceable ) {
			return notReplaceable;
		}
		const rootClientId = getBlockRootClientId( clientId ) ?? undefined;
		const notAllowed = canInsert( blocks, rootClientId );
		if ( notAllowed ) {
			return failed( notAllowed );
		}

		const actions = dispatch( blockEditorStore );
		if ( isReplace ) {
			// The new blocks are selected only when the block was, without
			// taking the focus from the chat.
			actions.replaceBlocks( [ clientId ], blocks, undefined, null );
			const newIds = blocks.map( ( block ) => block.clientId );
			clientIds = clientIds.flatMap( ( id ) => ( id === clientId ? newIds : [ id ] ) );
			if ( anchor === clientId ) {
				anchor = newIds[ newIds.length - 1 ];
			}
		} else {
			const index = getBlockIndex( clientId ) + ( edit.action === 'insert_before' ? 0 : 1 );
			actions.insertBlocks( blocks, index, rootClientId, false );
		}
		return applied( blocks );
	}

	/**
	 * Replaces the one place in the document whose markup is `find`. Only
	 * the smallest blocks that hold it are replaced, and of those, only the
	 * ones that change.
	 *
	 * @param find   The markup to replace.
	 * @param markup The new markup.
	 * @return What became of the edit.
	 */
	function replaceText( find: string, markup: string ): AiEditResult {
		const { getBlockRootClientId, getBlocks } = editor();
		const document = serialize( getBlocks() );
		const found = findUniqueText( document, stripRefs( find ) );
		if ( 'reason' in found ) {
			return failed( found.reason );
		}
		const located = locateText( getBlocks(), document, found.start, found.end );
		if ( ! located ) {
			return failed(
				'The "find" text is not inside the blocks. Include whole blocks or text inside one block, and try again.'
			);
		}

		// Classic blocks are kept as they are, so they are not edited, made
		// into other blocks, or removed.
		if ( hasClassicBlock( located.blocks ) ) {
			return failed(
				'The "find" text is in or around a Classic (core/freeform) block. Classic blocks must be kept exactly as they are, so they cannot be edited, turned into other blocks, or removed. Change only text outside Classic blocks. When the user needs to change a Classic block, tell them to edit or convert it themselves.'
			);
		}

		const replaced = [
			located.markup.slice( 0, located.start ),
			stripRefs( markup ),
			located.markup.slice( located.end ),
		].join( '' );
		const blocks = readBlocks( replaced );
		if ( typeof blocks === 'string' ) {
			return failed( blocks );
		}
		const protectedChange = findProtectedChange( located.blocks, blocks );
		if ( protectedChange ) {
			return failed( protectedChange );
		}

		// Blocks at either end that stay the same keep their place, so that
		// only what changed is highlighted.
		const before = [ ...located.blocks ];
		const same = ( a: Block | undefined, b: Block | undefined ) =>
			!! a && !! b && serialize( [ a ] ) === serialize( [ b ] );
		while ( before.length > 1 && blocks.length > 1 && same( before[ 0 ], blocks[ 0 ] ) ) {
			before.shift();
			blocks.shift();
		}
		while ( before.length > 1 && blocks.length > 1 && same( before.at( -1 ), blocks.at( -1 ) ) ) {
			before.pop();
			blocks.pop();
		}
		if ( before.length === 1 && blocks.length === 1 && same( before[ 0 ], blocks[ 0 ] ) ) {
			return { status: 'applied', refs: [], ...( autoFix && { autoFix } ) };
		}

		if ( hasSameStructure( before, blocks ) ) {
			return updateInPlace( before, blocks );
		}
		const ids = before.map( ( block ) => block.clientId );
		const notReplaceable = checkReplaceable( ids );
		if ( notReplaceable ) {
			return notReplaceable;
		}
		const notAllowed = canInsert( blocks, getBlockRootClientId( ids[ 0 ] ) ?? undefined );
		if ( notAllowed ) {
			return failed( notAllowed );
		}

		// The new blocks are selected only when the old ones were, without
		// taking the focus from the chat.
		dispatch( blockEditorStore ).replaceBlocks( ids, blocks, undefined, null );
		const newIds = blocks.map( ( block ) => block.clientId );
		const index = clientIds.findIndex( ( id ) => ids.includes( id ) );
		if ( index !== -1 ) {
			clientIds = clientIds.filter( ( id ) => ! ids.includes( id ) );
			clientIds.splice( index, 0, ...newIds );
		}
		if ( anchor && ids.includes( anchor ) ) {
			anchor = newIds[ newIds.length - 1 ];
		}
		return applied( blocks );
	}

	/**
	 * Applies the model's edit.
	 *
	 * @param edit The edit.
	 * @return What became of the edit.
	 */
	function applyEdit( edit: AiEdit ): AiEditResult {
		if ( edit.action === 'replace_text' ) {
			return replaceText( edit.find, edit.markup );
		}
		// `replace` and `append` do not point at a block, so a `ref` with them is ignored.
		if ( edit.action !== 'replace' && edit.action !== 'append' && edit.ref !== undefined ) {
			return applyToRef( edit, edit.ref );
		}
		if ( edit.action !== 'replace' && edit.action !== 'insert_after' && edit.action !== 'append' ) {
			return failed( `The "${ edit.action }" action needs the "ref" of a block.` );
		}

		const { getBlock, getBlockIndex, getBlockRootClientId, getBlocksByClientId } = editor();
		const isAppend = edit.action === 'append';
		if ( ! isAppend && clientIds.some( ( clientId ) => ! getBlock( clientId ) ) ) {
			return { status: 'dropped' };
		}
		if ( anchor && ! getBlock( anchor ) ) {
			anchor = clientIds[ clientIds.length - 1 ];
		}

		const blocks = readBlocks( edit.markup );
		if ( typeof blocks === 'string' ) {
			return failed( blocks );
		}

		const isReplace = edit.action === 'replace';
		if ( isReplace && ! clientIds.length ) {
			return failed(
				'Nothing is selected, so there is nothing to replace. Use "replace_block" with the reference ID of the block to replace, or "append" to add blocks to the end of the document.'
			);
		}
		const changed = isReplace && checkUnchanged( clientIds );
		if ( changed ) {
			return changed;
		}
		const replaced = isReplace
			? getBlocksByClientId( clientIds ).filter( ( block ) => block !== null )
			: [];
		const protectedChange = findProtectedChange( replaced, blocks );
		if ( protectedChange ) {
			return failed( protectedChange );
		}
		if ( isReplace && hasSameStructure( replaced, blocks ) ) {
			return updateInPlace( replaced, blocks );
		}
		const notReplaceable = isReplace && checkReplaceable( clientIds );
		if ( notReplaceable ) {
			return notReplaceable;
		}
		const rootClientId =
			anchor && ! isAppend ? ( getBlockRootClientId( anchor ) ?? undefined ) : undefined;
		const notAllowed = canInsert( blocks, rootClientId );
		if ( notAllowed ) {
			return failed( notAllowed );
		}

		const actions = dispatch( blockEditorStore );
		const last = blocks[ blocks.length - 1 ].clientId;
		if ( isAppend ) {
			actions.insertBlocks( blocks, undefined, undefined, false );
		} else if ( isReplace ) {
			if ( ! anchor || clientIds.includes( anchor ) ) {
				anchor = last;
			}
			// The new blocks are selected, without taking the focus from the chat.
			actions.replaceBlocks( clientIds, blocks, undefined, null );
			clientIds = blocks.map( ( block ) => block.clientId );
		} else {
			// Without an anchor, the blocks go to the end of the document.
			const index = anchor ? getBlockIndex( anchor ) + 1 : undefined;
			// Keep the selection, and the focus in the chat.
			actions.insertBlocks( blocks, index, rootClientId, false );
			anchor = last;
		}
		return applied( blocks );
	}

	return {
		getContext: () => ( {
			document: getDocument(),
			selection: serializeWithRefs(
				editor()
					.getBlocksByClientId( clientIds )
					.filter( ( block ) => block !== null )
			),
		} ),
		getDocument,
		markRead: seen.markRead,
		apply: ( edit ) => seen.track( () => applyEdit( edit ) ),
	};
}

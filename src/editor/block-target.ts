/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import type { Block } from '@wordpress/blocks';
import { getBlockType, serialize } from '@wordpress/blocks';
import { dispatch, select } from '@wordpress/data';

/**
 * Internal dependencies
 */
import type { EditTarget } from '../ai/edit-target';
import { findUniqueText } from '../ai/find-text';
import type { AiEdit, AiEditResult } from '../platform';
import { getClientIdByRef, getRef, serializeWithRefs, stripRefs } from './block-refs';
import { locateText } from './locate-text';
import { collectUnsafeHtml } from './unsafe-html';
import { collectHtml, validateMarkup } from './validate-markup';

function failed( reason: string ): AiEditResult {
	return { status: 'failed', reason };
}

/**
 * Creates the edit target for the blocks selected now. Blocks anywhere in
 * the document can also be edited by their reference IDs, which the
 * document and the selection carry before each block.
 *
 * Each edit is one undo step.
 *
 * @return The edit target.
 */
export function createBlockTarget(): EditTarget {
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

	function canInsert( blocks: Block[], rootClientId: string | undefined ): string | null {
		const notAllowed = blocks.find(
			( block ) => ! editor().canInsertBlockType( block.name, rootClientId )
		);
		return notAllowed ? explainNotAllowed( notAllowed.name, rootClientId ) : null;
	}

	/**
	 * Explains why a block cannot be inserted, with the rules for where it
	 * can go from its block.json and the block.json of the parent, so that
	 * the model can find a place it can go.
	 *
	 * @param name         The name of the block.
	 * @param rootClientId The parent the block was inserted into.
	 * @return The explanation.
	 */
	function explainNotAllowed( name: string, rootClientId: string | undefined ): string {
		const quote = ( names: string[] ) => names.map( ( item ) => `"${ item }"` ).join( ' or ' );
		const reasons = [ `The "${ name }" block is not allowed here.` ];
		const { parent, ancestor } = getBlockType( name ) ?? {};
		if ( parent?.length ) {
			reasons.push( `It can only be placed directly inside ${ quote( parent ) }.` );
		}
		if ( ancestor?.length ) {
			reasons.push( `It can only be placed somewhere inside ${ quote( ancestor ) }.` );
		}
		const rootName = rootClientId ? editor().getBlockName( rootClientId ) : null;
		const allowedBlocks = rootName ? getBlockType( rootName )?.allowedBlocks : undefined;
		if ( rootName && allowedBlocks?.length && ! allowedBlocks.includes( name ) ) {
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
		const isRemoved = edit.action === 'replace_block' || edit.action === 'delete_block';
		if ( isRemoved && ! canRemoveBlocks( [ clientId ] ) ) {
			return failed( `The block "${ ref }" is locked, so it cannot be changed or removed.` );
		}

		const actions = dispatch( blockEditorStore );
		if ( edit.action === 'delete_block' ) {
			actions.removeBlocks( [ clientId ], false );
			clientIds = clientIds.filter( ( id ) => id !== clientId );
			return { status: 'applied', refs: [] };
		}

		const blocks = readBlocks( edit.markup );
		if ( typeof blocks === 'string' ) {
			return failed( blocks );
		}
		const rootClientId = getBlockRootClientId( clientId ) ?? undefined;
		const notAllowed = canInsert( blocks, rootClientId );
		if ( notAllowed ) {
			return failed( notAllowed );
		}

		if ( edit.action === 'replace_block' ) {
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
		const { canRemoveBlocks, getBlockRootClientId, getBlocks } = editor();
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

		const replaced = [
			located.markup.slice( 0, located.start ),
			stripRefs( markup ),
			located.markup.slice( located.end ),
		].join( '' );
		const blocks = readBlocks( replaced );
		if ( typeof blocks === 'string' ) {
			return failed( blocks );
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

		const ids = before.map( ( block ) => block.clientId );
		if ( ! canRemoveBlocks( ids ) ) {
			return failed( 'The blocks with the "find" text are locked, so they cannot be changed.' );
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
		apply( edit ) {
			if ( edit.action === 'replace_text' ) {
				return replaceText( edit.find, edit.markup );
			}
			// `replace` and `append` do not point at a block, so a `ref` with them is ignored.
			if ( edit.action !== 'replace' && edit.action !== 'append' && edit.ref !== undefined ) {
				return applyToRef( edit, edit.ref );
			}
			if (
				edit.action !== 'replace' &&
				edit.action !== 'insert_after' &&
				edit.action !== 'append'
			) {
				return failed( `The "${ edit.action }" action needs the "ref" of a block.` );
			}

			const { canRemoveBlocks, getBlock, getBlockIndex, getBlockRootClientId } = editor();
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
			if ( isReplace && ! canRemoveBlocks( clientIds ) ) {
				return failed( 'The selected blocks are locked, so they cannot be replaced.' );
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
		},
	};
}

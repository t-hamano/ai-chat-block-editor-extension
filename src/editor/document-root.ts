/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import type { Block } from '@wordpress/blocks';
import { select } from '@wordpress/data';

type Editor = ReturnType< typeof select< typeof blockEditorStore > >;

/**
 * Whether a block is part of the document the AI edits. Blocks inside a
 * block that shows content kept elsewhere, such as a template part or a
 * synced pattern, are not: the block controls its inner blocks, which are
 * left out of the document, and they are edited in its own editor.
 *
 * @param clientId The block's client ID.
 * @param root     The block that holds the document, if any.
 * @param editor   The block editor selectors. Pass the ones from
 *                 `useSelect` to rerender when the blocks change.
 * @return Whether the block is in the document.
 */
export function isInDocument(
	clientId: string,
	root: string | undefined,
	editor: Editor = select( blockEditorStore )
): boolean {
	// Nearest first, so that the root is reached before the blocks around it.
	for ( const parent of editor.getBlockParents( clientId, true ) ) {
		if ( parent === root ) {
			return true;
		}
		if ( editor.areInnerBlocksControlled( parent ) ) {
			return false;
		}
	}
	return root === undefined;
}

/**
 * Leaves out the inner blocks of the blocks that show content kept
 * elsewhere, such as template parts and synced patterns, so that the
 * document has them without their content. The store gives them their
 * inner blocks in some states, such as after the blocks are reset, and not
 * in others.
 *
 * @param blocks The blocks.
 * @param editor The block editor selectors.
 * @return Copies of the blocks.
 */
export function withoutControlledContent(
	blocks: Block[],
	editor: Editor = select( blockEditorStore )
): Block[] {
	return blocks.map( ( block ) => ( {
		...block,
		innerBlocks: editor.areInnerBlocksControlled( block.clientId )
			? []
			: withoutControlledContent( block.innerBlocks, editor ),
	} ) );
}

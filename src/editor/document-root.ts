/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import type { Block } from '@wordpress/blocks';
import { select } from '@wordpress/data';

type Editor = ReturnType< typeof select< typeof blockEditorStore > >;

/**
 * Finds the block that holds the document the AI edits. When the editor
 * shows the template around the post, the template is locked, and the post
 * is the content of the Post Content block, as the editor's inserter also
 * finds it.
 *
 * @param isTemplateLocked Whether the editor shows the template around the
 *                         post.
 * @param editor           The block editor selectors. Pass the ones from
 *                         `useSelect` to rerender when the blocks change.
 * @return The client ID of the Post Content block, or `undefined` when the
 *         document is the whole editor.
 */
export function getDocumentRoot(
	isTemplateLocked: boolean,
	editor: Editor = select( blockEditorStore )
): string | undefined {
	return isTemplateLocked ? editor.getBlocksByName( 'core/post-content' )[ 0 ] : undefined;
}

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
 * @return The blocks, the same objects where nothing is left out.
 */
export function withoutControlledContent(
	blocks: Block[],
	editor: Editor = select( blockEditorStore )
): Block[] {
	return blocks.map( ( block ) => {
		if ( editor.areInnerBlocksControlled( block.clientId ) ) {
			return block.innerBlocks.length ? { ...block, innerBlocks: [] } : block;
		}
		const innerBlocks = withoutControlledContent( block.innerBlocks, editor );
		return innerBlocks.every( ( inner, index ) => inner === block.innerBlocks[ index ] )
			? block
			: { ...block, innerBlocks };
	} );
}

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { createSelectionTarget } from './text-target';

/**
 * Returns the block that holds the document the AI edits, and a function
 * that makes the target for what the user selected.
 *
 * The hook returns a function and not the target itself, because a target
 * takes the selection when it is made and keeps track of the blocks the AI
 * saw while one answer comes in. So a new one is made each time a message
 * is sent.
 *
 * @return The document root and the function that makes the target.
 */
export function useSelectionTarget() {
	// When the template is shown around the post, the post is inside the
	// Post Content block, as the editor also finds it.
	const documentRoot = useSelect(
		( select ) =>
			select( editorStore ).getRenderingMode() === 'template-locked'
				? select( blockEditorStore ).getBlocksByName( 'core/post-content' )[ 0 ]
				: undefined,
		[]
	);
	const createTarget = useCallback( () => createSelectionTarget( documentRoot ), [ documentRoot ] );
	return { documentRoot, createTarget };
}

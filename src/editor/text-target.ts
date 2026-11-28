/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { dispatch, select } from '@wordpress/data';
import { create, insert, RichTextData, slice, toHTMLString } from '@wordpress/rich-text';

/**
 * Internal dependencies
 */
import type { EditTarget } from '../ai/edit-target';
import type { AiEditResult } from '../platform';
import { getRef, stripRefs } from './block-refs';
import { createBlockTarget } from './block-target';
import { createSeenBlocks } from './seen-blocks';
import { explainUnsafeHtml, findUnsafeHtml } from './unsafe-html';

/**
 * Tags that start a new block of content, which a text range inside one
 * block cannot hold.
 */
const BLOCK_TAG =
	/<\/?(?:address|article|aside|blockquote|details|div|dl|dd|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)\b/i;

/**
 * A range of text the user selected inside one rich text attribute of a
 * block.
 */
type TextSelection = {
	clientId: string;
	attributeKey: string;
	start: number;
	end: number;
};

/**
 * Returns the text range the user selected now, when it is inside one rich
 * text attribute of one block and is not collapsed.
 *
 * @param editor The block editor selectors. Pass the ones from `useSelect`
 *               to rerender when the selection changes.
 * @return The range, or `null` when there is none.
 */
export function getTextSelection(
	editor: ReturnType< typeof select< typeof blockEditorStore > > = select( blockEditorStore )
): TextSelection | null {
	const { getBlockAttributes, getSelectionEnd, getSelectionStart } = editor;
	const start = getSelectionStart();
	const end = getSelectionEnd();
	if (
		! start.clientId ||
		start.clientId !== end.clientId ||
		! start.attributeKey ||
		start.attributeKey !== end.attributeKey ||
		typeof start.offset !== 'number' ||
		typeof end.offset !== 'number' ||
		start.offset === end.offset
	) {
		return null;
	}
	const attributes = getBlockAttributes( start.clientId );
	const value = attributes?.[ start.attributeKey ];
	if ( ! ( value instanceof RichTextData ) && typeof value !== 'string' ) {
		return null;
	}
	return {
		clientId: start.clientId,
		attributeKey: start.attributeKey,
		start: Math.min( start.offset, end.offset ),
		end: Math.max( start.offset, end.offset ),
	};
}

/**
 * Creates the edit target for a text range selected inside one block. The
 * selection is sent to the model as inline HTML, and `replace` replaces
 * only that range, with inline HTML. The other edits work as with the
 * block: `insert_after` adds blocks after the block that holds the range,
 * and edits by reference ID or `replace_text` change any block.
 *
 * Each edit is one undo step.
 *
 * @param selection The selected range.
 * @return The edit target.
 */
export function createTextTarget( selection: TextSelection ): EditTarget {
	const seen = createSeenBlocks();
	const blockTarget = createBlockTarget( seen );
	const { clientId, attributeKey } = selection;
	let { start, end } = selection;

	const readHtml = () => {
		const value = select( blockEditorStore ).getBlockAttributes( clientId )?.[ attributeKey ];
		if ( value instanceof RichTextData ) {
			return value.toHTMLString();
		}
		return typeof value === 'string' ? value : null;
	};
	// The attribute as it was when the range was captured or last replaced.
	// When something else changed it, the range may no longer point at the
	// same text.
	let expected = readHtml();

	function replaceRange( markup: string ): AiEditResult {
		const html = readHtml();
		if ( html === null ) {
			return { status: 'dropped' };
		}
		if ( html !== expected ) {
			return {
				status: 'failed',
				reason: `The user changed the text of the block "${ getRef( clientId ) }" after it was selected, so the selection may no longer point at the same text, and the edit was not applied. Read the block again with "read_blocks", and change the text with "replace_text" or "replace_block".`,
			};
		}
		const inline = stripRefs( markup );
		if ( /<!--\s*\/?wp:/.test( inline ) || BLOCK_TAG.test( inline ) ) {
			return {
				status: 'failed',
				reason:
					'The selection is text inside a block, so "replace" takes inline HTML only, such as text with <strong>, <em>, or <a>, without block comments or tags such as <p>. To change the whole block, use "replace_block" with its reference ID.',
			};
		}
		// HTML that can run code is kept only when the text already has it.
		const existing = new Set( findUnsafeHtml( html ).map( ( { snippet } ) => snippet ) );
		const unsafe = findUnsafeHtml( inline ).filter( ( { snippet } ) => ! existing.has( snippet ) );
		if ( unsafe.length ) {
			return {
				status: 'failed',
				reason: explainUnsafeHtml( 'The replacement', unsafe ),
			};
		}
		if ( ! select( blockEditorStore ).canEditBlock( clientId ) ) {
			return {
				status: 'failed',
				reason: 'The block with the selected text is locked, so it cannot be changed.',
			};
		}

		const replacement = create( { html: inline } );
		const value = insert( create( { html } ), replacement, start, end );
		const next = toHTMLString( { value } );
		const current = select( blockEditorStore ).getBlockAttributes( clientId )?.[ attributeKey ];
		const actions = dispatch( blockEditorStore );
		actions.updateBlockAttributes( clientId, {
			[ attributeKey ]:
				current instanceof RichTextData ? RichTextData.fromHTMLString( next ) : next,
		} );
		end = start + replacement.text.length;
		expected = readHtml();
		// Keep the replaced text selected, so that the next message is about
		// it. The editor applies it only once the block has the focus, so the
		// focus stays in the chat.
		actions.selectionChange( clientId, attributeKey, start, end );
		return { status: 'applied', refs: [ getRef( clientId ) ] };
	}

	return {
		getContext() {
			const html = readHtml() ?? '';
			return {
				document: blockTarget.getDocument(),
				selection: toHTMLString( { value: slice( create( { html } ), start, end ) } ),
				textIn: getRef( clientId ),
			};
		},
		getDocument: blockTarget.getDocument,
		markRead: blockTarget.markRead,
		apply( edit ) {
			return edit.action === 'replace'
				? seen.track( () => replaceRange( edit.markup ) )
				: blockTarget.apply( edit );
		},
	};
}

/**
 * Creates the edit target for the selection now: a text range inside one
 * block, or else the selected blocks.
 *
 * @return The edit target.
 */
export function createSelectionTarget(): EditTarget {
	const selection = getTextSelection();
	return selection ? createTextTarget( selection ) : createBlockTarget();
}

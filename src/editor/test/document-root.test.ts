// @vitest-environment jsdom

/**
 * External dependencies
 */
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { InnerBlocks, store as blockEditorStore } from '@wordpress/block-editor';
import { createBlock, registerBlockType } from '@wordpress/blocks';
import { dispatch } from '@wordpress/data';
import { createElement } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { isInDocument } from '../document-root';

beforeAll( () => {
	registerBlockType( 'test/paragraph', {
		apiVersion: 3,
		title: 'Paragraph',
		category: 'text',
		attributes: {},
		edit: () => null,
		save: () => createElement( 'p' ),
	} );
	registerBlockType( 'core/post-content', {
		apiVersion: 3,
		title: 'Content',
		category: 'theme',
		attributes: {},
		edit: () => null,
		save: () => createElement( InnerBlocks.Content ),
	} );
} );

// A template with a paragraph, and the Post Content block, which controls
// the post's blocks inside it.
function setUpTemplate() {
	const outside = createBlock( 'test/paragraph' );
	const content = createBlock( 'core/post-content' );
	const post = createBlock( 'test/paragraph' );
	dispatch( blockEditorStore ).resetBlocks( [ outside, content ] );
	dispatch( blockEditorStore ).setHasControlledInnerBlocks( content.clientId, true );
	dispatch( blockEditorStore ).replaceInnerBlocks( content.clientId, [ post ] );
	return { outside: outside.clientId, content: content.clientId, post: post.clientId };
}

describe( 'isInDocument', () => {
	it( 'leaves out the blocks inside a block that controls them', () => {
		const { outside, content, post } = setUpTemplate();

		expect( isInDocument( outside, undefined ) ).toBe( true );
		expect( isInDocument( content, undefined ) ).toBe( true );
		expect( isInDocument( post, undefined ) ).toBe( false );
	} );

	it( 'takes in only the blocks inside the root when there is one', () => {
		const { outside, content, post } = setUpTemplate();

		expect( isInDocument( post, content ) ).toBe( true );
		expect( isInDocument( outside, content ) ).toBe( false );
		expect( isInDocument( content, content ) ).toBe( false );
	} );
} );

// @vitest-environment jsdom

/**
 * External dependencies
 */
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { registerCoreBlocks } from '@wordpress/block-library';
import { registerBlockStyle, registerBlockType } from '@wordpress/blocks';
import { dispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { getSiteInfo } from '../site-info';

const black = { slug: 'black', name: 'Black', color: '#000000' };
const base = { slug: 'base', name: 'Base', color: '#ffffff' };

const features = {
	color: {
		palette: {
			default: [ black, { slug: 'white', name: 'White', color: '#ffffff' } ],
			theme: [ base, { slug: 'accent', name: 'Accent', color: '#ff0000' } ],
			custom: [ { slug: 'accent', name: 'My accent', color: '#00ff00' } ],
		},
		gradients: {
			default: [ { slug: 'dawn', name: 'Dawn', gradient: 'linear-gradient(#000,#fff)' } ],
		},
		defaultPalette: false,
	},
	typography: {
		fontFamilies: {
			theme: [
				{
					slug: 'manrope',
					name: 'Manrope',
					fontFamily: 'Manrope, sans-serif',
					fontFace: [ { fontFamily: 'Manrope', src: [ 'https://example.com/manrope.woff2' ] } ],
				},
			],
		},
	},
	blocks: {
		'core/heading': { color: { custom: false } },
		'core/button': { color: { palette: { theme: [ black ] } } },
		'core/quote': { color: { defaultPalette: true } },
	},
};

/**
 * Reads one section of the site information.
 *
 * @param text    The site information.
 * @param heading The section's heading.
 * @return The section's content.
 */
function section( text: string, heading: string ): string {
	return text.split( `## ${ heading }\n\n` )[ 1 ].split( '\n\n## ' )[ 0 ];
}

beforeAll( () => {
	registerCoreBlocks();
	registerBlockType( 'my-plugin/card', {
		apiVersion: 3,
		title: 'Card',
		category: 'design',
		parent: [ 'core/group' ],
		attributes: {
			tone: { type: 'string', enum: [ 'calm', 'loud' ], default: 'calm' },
			preview: { type: 'string', role: 'local' },
		},
		supports: { spacing: { padding: true } },
		edit: () => null,
		save: () => null,
	} );
	registerBlockType( 'my-plugin/hidden', {
		apiVersion: 3,
		title: 'Hidden',
		category: 'design',
		attributes: {},
		supports: { inserter: false },
		edit: () => null,
		save: () => null,
	} );
	registerBlockStyle( 'my-plugin/card', { name: 'outlined', label: 'Outlined' } );
	dispatch( blockEditorStore ).updateSettings( { __experimentalFeatures: features } );
} );

describe( 'getSiteInfo', () => {
	it( 'lists core blocks by name', () => {
		const names = section( getSiteInfo(), 'Core blocks' ).split( ', ' );
		expect( names ).toContain( 'paragraph' );
		expect( names ).not.toContain( 'core/paragraph' );
	} );

	it( 'describes blocks from plugins as in their block.json', () => {
		const [ card, ...others ] = JSON.parse( section( getSiteInfo(), 'Blocks from plugins' ) );
		expect( others ).toEqual( [] );
		expect( card ).toMatchObject( {
			name: 'my-plugin/card',
			title: 'Card',
			parent: [ 'core/group' ],
			supports: { spacing: { padding: true } },
		} );
		expect( card.attributes.tone ).toEqual( {
			type: 'string',
			enum: [ 'calm', 'loud' ],
			default: 'calm',
		} );
		expect( card.attributes.preview ).toBeUndefined();
	} );

	it( 'lists the block styles', () => {
		const styles = JSON.parse( section( getSiteInfo(), 'Block styles' ) );
		expect( styles[ 'my-plugin/card' ] ).toEqual( [ 'outlined' ] );
		expect( styles[ 'core/button' ] ).toEqual( [ 'fill', 'outline' ] );
	} );

	it( 'passes the theme.json settings', () => {
		const settings = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		expect( settings.blocks[ 'core/heading' ] ).toEqual( { color: { custom: false } } );
	} );

	it( 'puts the presets of every origin in one list, as the editor offers them', () => {
		const { color } = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		// WordPress's palette is turned off, and the user's accent replaces the theme's.
		expect( color.palette ).toEqual( [
			base,
			{ slug: 'accent', name: 'My accent', color: '#00ff00' },
		] );
		expect( color.gradients ).toEqual( features.color.gradients.default );
		// The setting is applied, so it is left out.
		expect( color.defaultPalette ).toBeUndefined();
	} );

	it( 'merges the presets of a block, with what it takes from the global settings', () => {
		const { blocks } = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		// The block's own theme presets, and the user's from the global settings.
		expect( blocks[ 'core/button' ].color.palette ).toEqual( [
			black,
			{ slug: 'accent', name: 'My accent', color: '#00ff00' },
		] );
		// A block that offers WordPress's presets gets them with the global ones.
		expect(
			blocks[ 'core/quote' ].color.palette.map( ( { slug }: { slug: string } ) => slug )
		).toEqual( [ 'black', 'white', 'base', 'accent' ] );
	} );

	it( 'leaves out the font files of font families', () => {
		const { typography } = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		expect( typography.fontFamilies ).toEqual( [
			{ slug: 'manrope', name: 'Manrope', fontFamily: 'Manrope, sans-serif' },
		] );
	} );

	it( 'leaves out blocks the editor does not allow', () => {
		dispatch( blockEditorStore ).updateSettings( {
			allowedBlockTypes: [ 'core/paragraph', 'my-plugin/card' ],
		} );
		try {
			const text = getSiteInfo();
			expect( section( text, 'Core blocks' ) ).toBe( 'paragraph' );
			expect( JSON.parse( section( text, 'Block styles' ) ) ).toEqual( {
				'my-plugin/card': [ 'outlined' ],
			} );
		} finally {
			dispatch( blockEditorStore ).updateSettings( { allowedBlockTypes: true } );
		}
	} );

	it( 'gives the same text for the same site, so the prompt cache holds', () => {
		expect( getSiteInfo() ).toBe( getSiteInfo() );
	} );
} );

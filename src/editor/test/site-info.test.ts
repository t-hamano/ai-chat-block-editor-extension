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
import { getBlockTypes, registerBlockStyle, registerBlockType } from '@wordpress/blocks';
import { dispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { getSiteInfo } from '../site-info';

const features = {
	color: {
		palette: {
			default: [ { slug: 'black', name: 'Black', color: '#000000' } ],
			theme: [ { slug: 'base', name: 'Base', color: '#ffffff' } ],
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
		'core/heading': {
			color: {
				custom: false,
				palette: { default: [ { slug: 'black', name: 'Black', color: '#000000' } ] },
			},
		},
		'core/button': {
			color: {
				defaultPalette: true,
				palette: { default: [ { slug: 'black', name: 'Black', color: '#000000' } ] },
			},
		},
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
	it( 'says all core blocks can be inserted when the editor allows them all', () => {
		expect( section( getSiteInfo(), 'Core blocks' ) ).toBe( 'All of them.' );
	} );

	it( 'lists the core blocks left out, by name, when they are fewer', () => {
		const names = getBlockTypes()
			.filter( ( { supports } ) => supports?.inserter !== false )
			.map( ( { name } ) => name )
			.filter( ( name ) => name !== 'core/quote' && name !== 'core/verse' );
		dispatch( blockEditorStore ).updateSettings( { allowedBlockTypes: names } );
		try {
			expect( section( getSiteInfo(), 'Core blocks' ) ).toBe( 'All except: quote, verse' );
		} finally {
			dispatch( blockEditorStore ).updateSettings( { allowedBlockTypes: true } );
		}
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
		expect( settings.color.palette.theme ).toEqual( features.color.palette.theme );
		expect( settings.color.defaultPalette ).toBe( false );
		expect( settings.blocks[ 'core/heading' ].color.custom ).toBe( false );
	} );

	it( 'leaves out the presets of WordPress that a setting turns off', () => {
		const settings = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		expect( settings.color.palette.default ).toBeUndefined();
		// The block's settings fall back to the global ones, unless they have their own.
		expect( settings.blocks[ 'core/heading' ].color.palette.default ).toBeUndefined();
		expect( settings.blocks[ 'core/button' ].color.palette.default ).toHaveLength( 1 );
		// A block that offers them keeps the ones it inherits from the global settings.
		expect( settings.blocks[ 'core/quote' ].color.palette.default ).toEqual(
			features.color.palette.default
		);
		// Only the setting that turns them off leaves them out.
		expect( settings.color.gradients.default ).toHaveLength( 1 );
	} );

	it( 'leaves out the font files of font families', () => {
		const settings = JSON.parse( section( getSiteInfo(), 'theme.json settings' ) );
		expect( settings.typography.fontFamilies.theme ).toEqual( [
			{ slug: 'manrope', name: 'Manrope', fontFamily: 'Manrope, sans-serif' },
		] );
	} );

	it( 'leaves out blocks the editor does not allow', () => {
		dispatch( blockEditorStore ).updateSettings( {
			allowedBlockTypes: [ 'core/paragraph', 'my-plugin/card' ],
		} );
		try {
			const text = getSiteInfo();
			expect( section( text, 'Core blocks' ) ).toBe( 'Only: paragraph' );
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

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { getBlockTypes, store as blocksStore, type BlockType } from '@wordpress/blocks';
import { select } from '@wordpress/data';

type BlockMetadata = BlockType & {
	parent?: string[];
	ancestor?: string[];
	allowedBlocks?: string[];
};

/**
 * Describes a block from a plugin the way its `block.json` does. Local
 * attributes, such as the `blob` of an upload, are never saved, so they
 * are left out.
 *
 * @param blockType The block type.
 * @return The description.
 */
function describeBlock( blockType: BlockMetadata ) {
	const attributes = Object.fromEntries(
		Object.entries( blockType.attributes ?? {} ).filter(
			( [ , schema ] ) => ( schema as { role?: string } ).role !== 'local'
		)
	);
	return {
		name: blockType.name,
		title: blockType.title,
		parent: blockType.parent,
		ancestor: blockType.ancestor,
		allowedBlocks: blockType.allowedBlocks,
		attributes,
		supports: blockType.supports,
	};
}

type Settings = Record< string, any >;

type Preset = { slug?: string; [ key: string ]: unknown };

/**
 * The preset lists of `theme.json`, with the setting that turns off the
 * presets of WordPress in them, when there is one.
 */
const PRESETS = [
	[ 'color', 'palette', 'defaultPalette' ],
	[ 'color', 'gradients', 'defaultGradients' ],
	[ 'color', 'duotone', 'defaultDuotone' ],
	[ 'typography', 'fontSizes', 'defaultFontSizes' ],
	[ 'typography', 'fontFamilies', null ],
	[ 'spacing', 'spacingSizes', 'defaultSpacingSizes' ],
	[ 'shadow', 'presets', 'defaultPresets' ],
	[ 'dimensions', 'aspectRatios', 'defaultAspectRatios' ],
] as const;

/**
 * Where presets come from, in the order WordPress applies them: a preset
 * of a later origin replaces one of an earlier origin with the same slug.
 */
const ORIGINS = [ 'default', 'theme', 'custom' ] as const;

/**
 * Puts the presets of the origins in one list, as the editor offers them:
 * the presets of WordPress only when the setting does not turn them off,
 * and for a slug in more than one origin, the preset of the later origin.
 * A font family keeps only what a block uses it by, without its font
 * files.
 *
 * @param byOrigin      The presets by origin.
 * @param offersDefault Whether the presets of WordPress are offered.
 * @return The presets.
 */
function mergePresets(
	byOrigin: Partial< Record< ( typeof ORIGINS )[ number ], Preset[] > >,
	offersDefault: boolean
): Preset[] {
	const presets = new Map< string, Preset >();
	for ( const origin of ORIGINS ) {
		if ( origin === 'default' && ! offersDefault ) {
			continue;
		}
		for ( const { fontFace: _, ...preset } of byOrigin[ origin ] ?? [] ) {
			presets.set( preset.slug ?? JSON.stringify( preset ), preset );
		}
	}
	return [ ...presets.values() ];
}

/**
 * Turns the preset lists of one level of the settings into the presets
 * the editor offers there. A block takes each origin and setting from the
 * global settings when it has none of its own, so it gets its own list
 * only when it has presets or such a setting of its own. The settings
 * that turn off the presets of WordPress are applied, so they are left
 * out.
 *
 * @param settings The settings of the level.
 * @param global   The global settings, or `null` for the global level.
 * @return The settings with the merged lists.
 */
function mergeLevel( settings: Settings, global: Settings | null ): Settings {
	const result = { ...settings };
	for ( const [ section, list, flag ] of PRESETS ) {
		const own = settings[ section ]?.[ list ];
		const ownFlag = flag ? settings[ section ]?.[ flag ] : undefined;
		if ( own === undefined && ( ! global || ownFlag === undefined ) ) {
			continue;
		}
		const inherited = global?.[ section ]?.[ list ] ?? {};
		const byOrigin = Object.fromEntries(
			ORIGINS.map( ( origin ) => [ origin, own?.[ origin ] ?? inherited[ origin ] ] )
		);
		const offersDefault = ( ownFlag ?? ( flag && global?.[ section ]?.[ flag ] ) ) !== false;
		const { [ flag ?? '' ]: _, ...rest } = result[ section ];
		result[ section ] = {
			...rest,
			[ list ]: Array.isArray( own ) ? own : mergePresets( byOrigin, offersDefault ),
		};
	}
	return result;
}

/**
 * Gives the model the `theme.json` settings with each preset list as the
 * presets the editor offers, at the top level and in the settings of each
 * block. The block markup refers to a preset only by its slug, so where
 * it comes from does not matter.
 *
 * @param settings The settings, as the editor has them.
 * @return The settings for the model.
 */
function mergeSettings( settings: Settings ): Settings {
	const result = mergeLevel( settings, null );
	if ( settings.blocks && typeof settings.blocks === 'object' ) {
		result.blocks = Object.fromEntries(
			Object.entries( settings.blocks as Record< string, Settings > ).map(
				( [ name, blockSettings ] ) => [ name, mergeLevel( blockSettings, settings ) ]
			)
		);
	}
	return result;
}

/**
 * Describes the site for the model: the blocks users can insert, their
 * block styles, and the `theme.json` settings with the presets the editor
 * offers.
 * Core blocks are the same on every site and known to the model, so they
 * are listed by name. The skill explains how to read the rest.
 *
 * @return The site information.
 */
export function getSiteInfo(): string {
	const settings = select( blockEditorStore ).getSettings() as Record< string, unknown >;
	const allowedBlockTypes = settings.allowedBlockTypes;
	const blockTypes = ( getBlockTypes() as BlockMetadata[] )
		.filter( ( blockType ) => blockType.supports?.inserter !== false )
		.filter(
			( blockType ) =>
				allowedBlockTypes !== false &&
				( ! Array.isArray( allowedBlockTypes ) || allowedBlockTypes.includes( blockType.name ) )
		)
		.sort( ( a, b ) => a.name.localeCompare( b.name ) );

	const isCore = ( blockType: BlockType ) => blockType.name.startsWith( 'core/' );
	const { getBlockStyles } = select( blocksStore );
	const styles = Object.fromEntries(
		blockTypes.flatMap( ( { name } ) => {
			const names = ( ( getBlockStyles( name ) ?? [] ) as { name: string }[] ).map(
				( style ) => style.name
			);
			return names.length ? [ [ name, names ] ] : [];
		} )
	);
	const core = blockTypes.filter( isCore ).map( ( { name } ) => name.slice( 'core/'.length ) );
	const plugins = blockTypes.filter( ( blockType ) => ! isCore( blockType ) ).map( describeBlock );

	return [
		'## Core blocks',
		'',
		core.join( ', ' ),
		'',
		'## Blocks from plugins',
		'',
		JSON.stringify( plugins ),
		'',
		'## Block styles',
		'',
		JSON.stringify( styles ),
		'',
		'## theme.json settings',
		'',
		JSON.stringify( mergeSettings( ( settings.__experimentalFeatures ?? {} ) as Settings ) ),
	].join( '\n' );
}

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

/**
 * The preset lists of `theme.json` that WordPress also offers its own
 * presets in, with the setting that turns those off.
 */
const DEFAULT_PRESETS = [
	[ 'color', 'palette', 'defaultPalette' ],
	[ 'color', 'gradients', 'defaultGradients' ],
	[ 'color', 'duotone', 'defaultDuotone' ],
	[ 'typography', 'fontSizes', 'defaultFontSizes' ],
	[ 'spacing', 'spacingSizes', 'defaultSpacingSizes' ],
	[ 'shadow', 'presets', 'defaultPresets' ],
	[ 'dimensions', 'aspectRatios', 'defaultAspectRatios' ],
] as const;

/**
 * Leaves out of one level of the settings what the model cannot use: the
 * presets of WordPress that a setting turns off, which the editor keeps
 * but does not offer, and the font files of each font family, since a
 * block uses a font family only by its slug.
 *
 * @param settings The settings of the level.
 * @param global   The global settings, which a block's settings fall back
 *                 to.
 * @return The settings without them.
 */
function trimLevel( settings: Settings, global: Settings ): Settings {
	const result = { ...settings };
	for ( const [ section, list, flag ] of DEFAULT_PRESETS ) {
		const presets = result[ section ]?.[ list ];
		const offersDefault = result[ section ]?.[ flag ] ?? global[ section ]?.[ flag ];
		if ( presets?.default && offersDefault === false ) {
			const { default: _, ...others } = presets;
			result[ section ] = { ...result[ section ], [ list ]: others };
		}
	}
	const families = result.typography?.fontFamilies;
	if ( families && typeof families === 'object' ) {
		result.typography = {
			...result.typography,
			fontFamilies: Object.fromEntries(
				Object.entries( families ).map( ( [ origin, items ] ) => [
					origin,
					Array.isArray( items ) ? items.map( ( { fontFace: _, ...family } ) => family ) : items,
				] )
			),
		};
	}
	return result;
}

/**
 * Leaves out of the `theme.json` settings what the model cannot use, at
 * the top level and in the settings of each block.
 *
 * @param settings The settings, as the editor has them.
 * @return The settings for the model.
 */
function trimSettings( settings: Settings ): Settings {
	const result = trimLevel( settings, settings );
	if ( settings.blocks && typeof settings.blocks === 'object' ) {
		result.blocks = Object.fromEntries(
			Object.entries( settings.blocks as Record< string, Settings > ).map(
				( [ name, blockSettings ] ) => [ name, trimLevel( blockSettings, settings ) ]
			)
		);
	}
	return result;
}

/**
 * Says which core blocks users can insert. Core blocks are the same on
 * every site and known to the model, so most sites allow all of them, and
 * the shorter of the blocks left out and the blocks allowed is listed, by
 * name.
 *
 * @param allowed The names of the core blocks users can insert.
 * @param others  The names of the other core blocks.
 * @return The text.
 */
function describeCoreBlocks( allowed: string[], others: string[] ): string {
	if ( ! others.length ) {
		return 'All of them.';
	}
	return others.length <= allowed.length
		? `All except: ${ others.join( ', ' ) }`
		: `Only: ${ allowed.join( ', ' ) }`;
}

/**
 * Describes the site for the model: the core blocks users can insert, the
 * blocks from plugins and the block styles of the blocks users can insert,
 * and the `theme.json` settings without what the model cannot use. The
 * skill explains how to read it.
 *
 * @return The site information.
 */
export function getSiteInfo(): string {
	const settings = select( blockEditorStore ).getSettings() as Record< string, unknown >;
	const allowedBlockTypes = settings.allowedBlockTypes;
	const isAllowed = ( blockType: BlockType ) =>
		allowedBlockTypes !== false &&
		( ! Array.isArray( allowedBlockTypes ) || allowedBlockTypes.includes( blockType.name ) );
	const insertable = ( getBlockTypes() as BlockMetadata[] )
		.filter( ( blockType ) => blockType.supports?.inserter !== false )
		.sort( ( a, b ) => a.name.localeCompare( b.name ) );
	const blockTypes = insertable.filter( isAllowed );

	const isCore = ( blockType: BlockType ) => blockType.name.startsWith( 'core/' );
	const coreName = ( { name }: BlockType ) => name.slice( 'core/'.length );
	const { getBlockStyles } = select( blocksStore );
	const styles = Object.fromEntries(
		blockTypes.flatMap( ( { name } ) => {
			const names = ( ( getBlockStyles( name ) ?? [] ) as { name: string }[] ).map(
				( style ) => style.name
			);
			return names.length ? [ [ name, names ] ] : [];
		} )
	);
	const core = insertable.filter( isCore );
	const plugins = blockTypes.filter( ( blockType ) => ! isCore( blockType ) ).map( describeBlock );

	return [
		'## Core blocks',
		'',
		describeCoreBlocks(
			core.filter( isAllowed ).map( coreName ),
			core.filter( ( blockType ) => ! isAllowed( blockType ) ).map( coreName )
		),
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
		JSON.stringify( trimSettings( ( settings.__experimentalFeatures ?? {} ) as Settings ) ),
	].join( '\n' );
}

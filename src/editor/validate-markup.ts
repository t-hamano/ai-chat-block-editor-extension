/**
 * WordPress dependencies
 */
import { parse as parseRaw } from '@wordpress/block-serialization-default-parser';
import {
	createBlock,
	getBlockAttributes,
	getBlockType,
	getFreeformContentHandlerName,
	getUnregisteredTypeHandlerName,
	parse,
	serialize,
	serializeRawBlock,
	validateBlock,
	type Block,
	type BlockType,
} from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import { explainUnsafeHtml, findUnsafeHtml } from './unsafe-html';

type RawBlock = ReturnType< typeof parseRaw >[ number ];

type AttributeSchema = { type?: string | string[]; enum?: unknown[]; source?: string };

/**
 * Whether the value has one of the types, as the parser checks them. A
 * value of the wrong type is dropped.
 *
 * @param value The value.
 * @param type  The attribute's type, or types.
 * @return Whether it does.
 */
function hasType( value: unknown, type: AttributeSchema[ 'type' ] ): boolean {
	if ( type === undefined ) {
		return true;
	}
	return ( Array.isArray( type ) ? type : [ type ] ).some( ( item ) => {
		switch ( item ) {
			case 'null':
				return value === null;
			case 'boolean':
			case 'string':
			case 'number':
				return typeof value === item;
			case 'integer':
				return Number.isInteger( value );
			case 'array':
				return Array.isArray( value );
			case 'object':
				return value !== null && typeof value === 'object' && ! Array.isArray( value );
			default:
				return true;
		}
	} );
}

/**
 * Whether the attribute takes the value.
 *
 * @param schema The attribute.
 * @param value  The value.
 * @return Whether it does.
 */
function accepts( schema: AttributeSchema, value: unknown ): boolean {
	return (
		hasType( value, schema.type ) &&
		( ! Array.isArray( schema.enum ) || schema.enum.includes( value ) )
	);
}

/**
 * What became of the markup the model wrote.
 */
export type MarkupValidation = {
	/**
	 * The parsed blocks. Blocks written in a deprecated form are in their
	 * migrated form.
	 */
	blocks: Block[];
	/**
	 * What is wrong with the markup, to tell the model. Empty when the
	 * blocks can be applied.
	 */
	problems: string[];
	/**
	 * What the automatic fix changed, to tell the model, when the markup
	 * was fixed. `blocks` are then the fixed blocks.
	 */
	autoFix?: string;
};

/**
 * The keys of a deprecation that replace the block type's, as the parser
 * applies them.
 */
const DEPRECATION_KEYS = [
	'attributes',
	'supports',
	'save',
	'migrate',
	'isEligible',
	'apiVersion',
];

/**
 * Finds the attributes of the version the parser reads the block with: the
 * current one, or the first deprecated one whose `save` matches the HTML.
 *
 * @param raw       The block, from the default parser.
 * @param blockType The block type.
 * @return The version's attributes.
 */
function getParsingAttributes(
	raw: RawBlock,
	blockType: BlockType
): Record< string, AttributeSchema > {
	const current = ( blockType.attributes ?? {} ) as Record< string, AttributeSchema >;
	if ( ! blockType.deprecated?.length ) {
		return current;
	}
	const innerBlocks = parse(
		raw.innerBlocks
			// Both parsers give the same shape, typed apart.
			.map( ( inner ) => serializeRawBlock( inner as Parameters< typeof serializeRawBlock >[ 0 ] ) )
			.join( '' )
	);
	const matches = ( version: BlockType ) =>
		validateBlock(
			{
				clientId: '',
				name: blockType.name,
				isValid: true,
				attributes: getBlockAttributes( version, raw.innerHTML, raw.attrs ?? {} ),
				innerBlocks,
				originalContent: raw.innerHTML,
			},
			version
		)[ 0 ];
	if ( matches( blockType ) ) {
		return current;
	}
	const base = Object.fromEntries(
		Object.entries( blockType ).filter( ( [ key ] ) => ! DEPRECATION_KEYS.includes( key ) )
	);
	for ( const deprecation of blockType.deprecated ) {
		const version = { ...base, ...deprecation } as BlockType;
		if ( matches( version ) ) {
			return ( version.attributes ?? {} ) as Record< string, AttributeSchema >;
		}
	}
	// The HTML matches no version, which the parsed block reports.
	return current;
}

/**
 * Checks the attributes in a block's comment against the version the parser
 * reads it with, since the parser drops without a word what that version
 * does not take.
 *
 * @param raw The block, from the default parser.
 * @return The problems.
 */
function checkAttributes( raw: RawBlock ): string[] {
	const name = raw.blockName as string;
	const blockType = getBlockType( name );
	if ( ! blockType ) {
		return [];
	}
	const schemas = getParsingAttributes( raw, blockType );
	const problems: string[] = [];
	for ( const [ key, value ] of Object.entries( raw.attrs ?? {} ) ) {
		const schema = schemas[ key ];
		if ( ! schema ) {
			problems.push( `"${ key }" is not an attribute of the ${ name } block.` );
		} else if ( schema.source ) {
			problems.push(
				`The "${ key }" attribute of the ${ name } block is read from its HTML, so do not put it in the block comment. Write it in the HTML.`
			);
		} else if ( ! accepts( schema, value ) ) {
			const expected = Array.isArray( schema.enum )
				? `Use one of: ${ schema.enum.map( ( item ) => JSON.stringify( item ) ).join( ', ' ) }.`
				: `Use a value of type ${ [ schema.type ].flat().join( ' or ' ) }.`;
			problems.push(
				`${ JSON.stringify( value ) } is not a value of the "${ key }" attribute of the ${ name } block. ${ expected }`
			);
		}
	}
	if ( problems.length ) {
		const names = Object.entries( schemas )
			.filter( ( [ , schema ] ) => ! schema.source )
			.map( ( [ key ] ) => key );
		problems.push( `The ${ name } block has these attributes: ${ names.join( ', ' ) }.` );
	}
	return problems;
}

/**
 * The blocks that hold HTML as it is, which the model cannot write, with
 * what to tell it. Only the user writes custom HTML, so that instructions in
 * the document cannot make the model add scripts to the site.
 */
const RAW_HTML_BLOCKS: Record< string, string > = {
	'core/html':
		'You cannot write core/html blocks, and core/html blocks in the document must be kept exactly as they are.',
	'core/freeform':
		'You cannot write core/freeform (Classic) blocks, and Classic blocks in the document must be kept exactly as they are.',
	'core/missing':
		'You cannot write core/missing blocks. They stand for blocks that are not registered on this site.',
};

/**
 * Checks the blocks as the model wrote them: their names, their attributes,
 * HTML outside blocks, what the blocks that hold HTML as it is hold, and
 * HTML that can run code.
 *
 * @param rawBlocks      The blocks, from the default parser.
 * @param existingHtml   The content of the blocks that hold HTML as it is
 *                       in the document, which the model may keep.
 * @param existingUnsafe The HTML that can run code in the document, which
 *                       the model may keep.
 * @param isTopLevel     Whether the blocks are at the top of the markup.
 * @return The problems.
 */
function checkRawBlocks(
	rawBlocks: RawBlock[],
	existingHtml: Set< string >,
	existingUnsafe: Set< string >,
	isTopLevel: boolean
): string[] {
	return rawBlocks.flatMap( ( raw ) => {
		if ( ! raw.blockName ) {
			const html = raw.innerHTML.trim();
			// Only the top level has HTML outside blocks: inside a block, it
			// belongs to the block.
			return isTopLevel && html
				? [
						`This HTML is not in a block, so it would become a Classic block: ${ html.slice(
							0,
							200
						) }. Wrap the content in block comment delimiters.`,
					]
				: [];
		}
		const name = raw.blockName;
		if ( ! getBlockType( name ) ) {
			return [ `The ${ name } block is not registered on this site. Use a registered block.` ];
		}
		const problems = checkAttributes( raw );
		if ( Object.hasOwn( RAW_HTML_BLOCKS, name ) ) {
			const html = raw.innerHTML.trim();
			if ( name === 'core/missing' || ( html && ! existingHtml.has( html ) ) ) {
				problems.push(
					`${ RAW_HTML_BLOCKS[ name ] } Write the content as core blocks, such as core/paragraph, core/heading, core/list, core/image, and core/group. When the user needs custom HTML, tell them to add or edit it themselves.`
				);
			}
		} else {
			// The HTML of the block itself: the inner blocks are checked on
			// their own.
			const unsafe = findUnsafeHtml( raw.innerHTML ).filter(
				( { snippet } ) => ! existingUnsafe.has( snippet )
			);
			if ( unsafe.length ) {
				problems.push( explainUnsafeHtml( `The ${ name } block`, unsafe ) );
			}
		}
		return [
			...problems,
			...checkRawBlocks( raw.innerBlocks, existingHtml, existingUnsafe, false ),
		];
	} );
}

/**
 * Checks that the blocks' HTML is what their `save` writes from their
 * attributes, and tells the model the markup that would be.
 *
 * @param blocks The parsed blocks.
 * @return The problems.
 */
function checkParsedBlocks( blocks: Block[] ): string[] {
	const fallbacks = [ getFreeformContentHandlerName(), getUnregisteredTypeHandlerName() ];
	return blocks.flatMap( ( block ) => {
		// The model's markup checks report these already.
		if ( fallbacks.includes( block.name ) ) {
			return [];
		}
		if ( block.isValid === false ) {
			const issues = ( block.validationIssues ?? [] )
				// The parser logs each message like the console does: a format
				// string whose `%s`, `%o` placeholders take the arguments that follow.
				.map( ( { args = [] }: { args?: unknown[] } ) => {
					const rest = args.slice( 1 );
					return String( args[ 0 ] ?? '' ).replace( /%[sodif]/g, ( placeholder ) => {
						if ( ! rest.length ) {
							return placeholder;
						}
						const value = rest.shift();
						return typeof value === 'object' ? JSON.stringify( value ) : String( value );
					} );
				} )
				.filter( ( issue: string ) => issue && ! issue.startsWith( 'Block validation failed' ) );
			const asValid = ( item: Block ): Block => ( {
				...item,
				isValid: true,
				innerBlocks: item.innerBlocks.map( asValid ),
			} );
			return [
				[
					`The HTML of this ${ block.name } block does not match its attributes${
						issues.length ? `: ${ issues.join( ' ' ) }` : '.'
					}`,
					block.originalContent ?? '',
					'With the same attributes, the block is written as:',
					// As its `save` writes it from the attributes the parser read,
					// with its inner blocks written the same way.
					serialize( asValid( block ) ),
				].join( '\n' ),
			];
		}
		return checkParsedBlocks( block.innerBlocks );
	} );
}

/**
 * Validates the block markup the model wrote, including nested blocks, as
 * the editor would read it.
 *
 * @param markup         The markup.
 * @param existingHtml   The content of the blocks that hold HTML as it is
 *                       in the document, which the model may keep as it is.
 * @param existingUnsafe The HTML that can run code in the document, which
 *                       the model may keep as it is.
 * @return The parsed blocks, and the problems to tell the model.
 */
export function validateMarkup(
	markup: string,
	existingHtml: Set< string > = new Set(),
	existingUnsafe: Set< string > = new Set()
): MarkupValidation {
	const blocks = parse( markup );
	const rawProblems = checkRawBlocks( parseRaw( markup ), existingHtml, existingUnsafe, true );
	const problems = [ ...rawProblems, ...checkParsedBlocks( blocks ) ];
	// Only HTML that drifted from what the attributes write is fixed: an
	// unknown block or attribute, HTML outside blocks, HTML that can run
	// code, or core/html is always for the model to fix.
	if ( ! problems.length || rawProblems.length ) {
		return { blocks, problems };
	}
	return autoFix( markup, blocks, existingHtml, existingUnsafe ) ?? { blocks, problems };
}

/**
 * Elements that show content without text.
 */
const MEDIA_ELEMENTS = [
	'audio',
	'canvas',
	'embed',
	'iframe',
	'img',
	'object',
	'picture',
	'source',
	'svg',
	'track',
	'video',
];

/**
 * Attributes that point at content: media and links.
 */
const CONTENT_ATTRIBUTES =
	/\b(?:src|srcset|href|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * What the markup shows: its text, without its tags, comments, and the
 * whitespace between them, and its media and the URLs it points at, which
 * have no text to compare.
 *
 * @param markup The markup.
 * @return What it shows.
 */
function toContent( markup: string ): string {
	const html = markup.replace( /<!--[\s\S]*?-->/g, ' ' );
	const text = html
		.replace( /<[^>]*>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
	const media = [ ...html.matchAll( /<([a-z][a-z0-9-]*)\b[^>]*>/gi ) ].flatMap(
		( [ tag, name ] ) => [
			...( MEDIA_ELEMENTS.includes( name.toLowerCase() ) ? [ name.toLowerCase() ] : [] ),
			...[ ...tag.matchAll( CONTENT_ATTRIBUTES ) ].map(
				( match ) => match[ 1 ] ?? match[ 2 ] ?? match[ 3 ]
			),
		]
	);
	return JSON.stringify( [ text, media ] );
}

/**
 * Rebuilds the blocks whose HTML does not match their attributes from the
 * attributes the parser read, as their `save` writes them.
 *
 * @param blocks  The parsed blocks.
 * @param changes Collects the rebuilt blocks, before and after.
 * @return The blocks, rebuilt where needed.
 */
function rebuild( blocks: Block[], changes: string[] ): Block[] {
	return blocks.map( ( block ) => {
		const innerBlocks = rebuild( block.innerBlocks, changes );
		if ( block.isValid !== false ) {
			return innerBlocks === block.innerBlocks ? block : { ...block, innerBlocks };
		}
		const fixed = createBlock( block.name, block.attributes, innerBlocks );
		changes.push(
			[ 'Before:', block.originalContent ?? '', 'After:', serialize( fixed ) ].join( '\n' )
		);
		return fixed;
	} );
}

/**
 * Fixes markup whose only problem is HTML that drifted from what the
 * blocks' attributes write. The fix is used only when it keeps the text,
 * media, and links, and the fixed markup passes every check.
 *
 * @param markup         The model's markup.
 * @param blocks         Its parsed blocks.
 * @param existingHtml   The content of the blocks that hold HTML as it is
 *                       in the document.
 * @param existingUnsafe The HTML that can run code in the document.
 * @return The fixed blocks, and what changed, or nothing.
 */
function autoFix(
	markup: string,
	blocks: Block[],
	existingHtml: Set< string >,
	existingUnsafe: Set< string >
): MarkupValidation | undefined {
	const changes: string[] = [];
	const fixedMarkup = serialize( rebuild( blocks, changes ) );
	if ( toContent( fixedMarkup ) !== toContent( markup ) ) {
		return undefined;
	}
	const fixed = parse( fixedMarkup );
	const problems = [
		...checkRawBlocks( parseRaw( fixedMarkup ), existingHtml, existingUnsafe, true ),
		...checkParsedBlocks( fixed ),
	];
	if ( problems.length ) {
		return undefined;
	}
	return {
		blocks: fixed,
		problems: [],
		autoFix: [
			'The HTML of some blocks did not match their attributes, so it was fixed automatically. Write blocks as the fixed markup does in later edits.',
			...changes,
		].join( '\n' ),
	};
}

/**
 * Collects the content of the blocks that hold HTML as it is, `core/html`
 * and Classic blocks, among the blocks.
 *
 * @param blocks The blocks.
 * @return The content.
 */
export function collectHtml( blocks: Block[] ): Set< string > {
	const html = new Set< string >();
	const visit = ( items: Block[] ) =>
		items.forEach( ( block ) => {
			if (
				( block.name === 'core/html' || block.name === 'core/freeform' ) &&
				typeof block.attributes.content === 'string'
			) {
				html.add( block.attributes.content.trim() );
			}
			visit( block.innerBlocks );
		} );
	visit( blocks );
	return html;
}

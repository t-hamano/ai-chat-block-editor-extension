/**
 * WordPress dependencies
 */
import { serialize, type Block } from '@wordpress/blocks';

/**
 * Elements that run code, load other documents, or change how the page
 * loads, including the SVG elements that can change other attributes.
 */
const UNSAFE_ELEMENTS = new Set( [
	'animate',
	'animatemotion',
	'animatetransform',
	'applet',
	'base',
	'embed',
	'foreignobject',
	'frame',
	'frameset',
	'handler',
	'iframe',
	'link',
	'meta',
	'noscript',
	'object',
	'portal',
	'script',
	'set',
	'style',
	'template',
] );

/**
 * Attributes that hold a URL.
 */
const URL_ATTRIBUTES = new Set( [
	'action',
	'background',
	'cite',
	'codebase',
	'data',
	'formaction',
	'href',
	'poster',
	'src',
	'xlink:href',
] );

/**
 * Elements that may show an image from a `data:` URL, which runs no code.
 */
const MEDIA_ELEMENTS = new Set( [ 'audio', 'img', 'source', 'track', 'video' ] );

/**
 * The URL schemes that WordPress allows in posts by default, as
 * `wp_allowed_protocols()` lists them.
 */
const SAFE_SCHEMES = new Set( [
	'fax',
	'feed',
	'ftp',
	'ftps',
	'gopher',
	'http',
	'https',
	'irc',
	'irc6',
	'ircs',
	'mailto',
	'mms',
	'news',
	'nntp',
	'rtsp',
	'sms',
	'svn',
	'tel',
	'telnet',
	'urn',
	'webcal',
	'xmpp',
] );

/**
 * HTML that is not allowed in what the model writes.
 */
export type UnsafeHtml = {
	/**
	 * What it is, to tell the model.
	 */
	description: string;
	/**
	 * The HTML, to find the same HTML in the document.
	 */
	snippet: string;
};

/**
 * Whether the URL is one that a post may link to or show.
 *
 * @param value     The URL.
 * @param allowData Whether a `data:` URL is allowed.
 * @return Whether it is.
 */
function isSafeUrl( value: string, allowData: boolean ): boolean {
	// Browsers ignore these characters in URLs, so `java\nscript:` runs too.
	const url = value.replace( /[\u0000- \u007f]/g, '' ).toLowerCase();
	const scheme = /^([a-z][a-z0-9+.-]*):/.exec( url )?.[ 1 ];
	if ( ! scheme ) {
		return true;
	}
	return scheme === 'data' ? allowData : SAFE_SCHEMES.has( scheme );
}

/**
 * Finds the URLs in an attribute: one, or the candidates of a `srcset`.
 *
 * @param name  The attribute's name.
 * @param value Its value.
 * @return The URLs.
 */
function getUrls( name: string, value: string ): string[] {
	if ( name === 'srcset' ) {
		return value
			.split( /,\s+/ )
			.map( ( candidate ) => candidate.trim().split( /\s+/ )[ 0 ] )
			.filter( Boolean );
	}
	return URL_ATTRIBUTES.has( name ) ? [ value ] : [];
}

/**
 * Finds the HTML that can run code: scripts and other elements that run or
 * load code, event handler attributes, and URLs with schemes other than
 * those WordPress allows in posts.
 *
 * The HTML is read with `DOMParser`, which runs nothing and loads nothing,
 * as the browser reads it, so that entities and odd spacing do not hide it.
 *
 * @param html The HTML.
 * @return What it found.
 */
export function findUnsafeHtml( html: string ): UnsafeHtml[] {
	if ( ! html.includes( '<' ) ) {
		return [];
	}
	const { body } = new DOMParser().parseFromString( `<body>${ html }</body>`, 'text/html' );
	const found: UnsafeHtml[] = [];
	for ( const element of body.querySelectorAll( '*' ) ) {
		const tag = element.localName.toLowerCase();
		if ( UNSAFE_ELEMENTS.has( tag ) ) {
			found.push( { description: `the <${ tag }> element`, snippet: element.outerHTML } );
			continue;
		}
		for ( const { name: attributeName, value } of Array.from( element.attributes ) ) {
			const name = attributeName.toLowerCase();
			const snippet = `<${ tag } ${ name }="${ value }">`;
			if ( name.startsWith( 'on' ) || name === 'srcdoc' ) {
				found.push( {
					description: `the "${ name }" attribute of <${ tag }>`,
					snippet,
				} );
				continue;
			}
			const allowData = MEDIA_ELEMENTS.has( tag ) && ( name === 'src' || name === 'srcset' );
			const unsafe = getUrls( name, value ).find( ( url ) => ! isSafeUrl( url, allowData ) );
			if ( unsafe !== undefined ) {
				found.push( {
					description: `the URL "${ unsafe.slice( 0, 100 ) }" in the "${ name }" attribute of <${ tag }>`,
					snippet,
				} );
			}
		}
	}
	return found;
}

/**
 * Collects the HTML that can run code in the document, which the model may
 * keep as it is, since only the user put it there.
 *
 * @param blocks The blocks of the document.
 * @return The HTML, as `findUnsafeHtml` gives it.
 */
export function collectUnsafeHtml( blocks: Block[] ): Set< string > {
	return new Set( findUnsafeHtml( serialize( blocks ) ).map( ( { snippet } ) => snippet ) );
}

/**
 * Explains to the model the HTML that it cannot write.
 *
 * @param unsafe Where the HTML is, such as "The core/paragraph block".
 * @param found  What was found.
 * @return The explanation.
 */
export function explainUnsafeHtml( unsafe: string, found: UnsafeHtml[] ): string {
	return `${ unsafe } has HTML that you cannot write: ${ found
		.map( ( { description } ) => description )
		.join(
			', '
		) }. Do not write scripts, styles, embedded frames or objects, event handler attributes such as onclick, or URLs such as javascript: that WordPress does not allow in posts. When the user needs them, tell them to add them themselves.`;
}

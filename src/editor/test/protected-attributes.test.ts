// @vitest-environment jsdom

/**
 * External dependencies
 */
import { describe, expect, it } from 'vitest';

/**
 * WordPress dependencies
 */
import { RichTextData } from '@wordpress/rich-text';

/**
 * Internal dependencies
 */
import { isEqual } from '../protected-attributes';

describe( 'isEqual', () => {
	it( 'compares objects whatever the order of their keys', () => {
		expect( isEqual( { a: 1, b: [ 1, { c: 2 } ] }, { b: [ 1, { c: 2 } ], a: 1 } ) ).toBe( true );
		expect( isEqual( { a: 1 }, { a: 1, b: undefined } ) ).toBe( true );
		expect( isEqual( { a: 1 }, { a: 2 } ) ).toBe( false );
		expect( isEqual( [ 1 ], { 0: 1 } ) ).toBe( false );
		expect( isEqual( undefined, {} ) ).toBe( false );
	} );

	it( 'compares rich text by its HTML', () => {
		const html = ( value: string ) => RichTextData.fromHTMLString( value );
		expect( isEqual( html( '<b>One</b>' ), html( '<b>One</b>' ) ) ).toBe( true );
		expect( isEqual( html( '<b>One</b>' ), html( '<i>One</i>' ) ) ).toBe( false );
	} );
} );

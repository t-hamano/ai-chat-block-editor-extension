/**
 * External dependencies
 */
import { describe, expect, it } from 'vitest';

/**
 * Internal dependencies
 */
import { describeApplied, toEdit } from '../tools';

describe( 'describeApplied', () => {
	it( 'tells the model the edit was applied, with the IDs of the new blocks', () => {
		expect( describeApplied( undefined ) ).toBe( 'The edit was applied.' );
		expect( describeApplied( [ 'b1', 'b2' ] ) ).toBe(
			'The edit was applied. The reference IDs of the new blocks are b1, b2.'
		);
	} );

	it( 'adds what the automatic fix changed', () => {
		expect( describeApplied( [ 'b1' ], 'Fixed.\nBefore:\n<p>A</p>' ) ).toBe(
			'The edit was applied. The reference IDs of the new blocks are b1.\n\nFixed.\nBefore:\n<p>A</p>'
		);
	} );
} );

describe( 'toEdit', () => {
	it( 'reads a text replacement, which may remove the text', () => {
		expect( toEdit( { action: 'replace_text', find: 'old', markup: 'new' } ) ).toEqual( {
			action: 'replace_text',
			find: 'old',
			markup: 'new',
		} );
		expect( toEdit( { action: 'replace_text', find: 'old' } ) ).toEqual( {
			action: 'replace_text',
			find: 'old',
			markup: '',
		} );
	} );

	it( 'needs the text to replace', () => {
		expect( toEdit( { action: 'replace_text', markup: 'new' } ) ).toBeNull();
		expect( toEdit( { action: 'replace_text', find: '', markup: 'new' } ) ).toBeNull();
		expect( toEdit( { action: 'replace_text', find: 1, markup: 'new' } ) ).toBeNull();
	} );
} );

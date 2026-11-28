// @vitest-environment jsdom

/**
 * External dependencies
 */
import { describe, expect, it } from 'vitest';

/**
 * Internal dependencies
 */
import { findUnsafeHtml } from '../unsafe-html';

const descriptions = ( html: string ) =>
	findUnsafeHtml( html ).map( ( { description } ) => description );

describe( 'findUnsafeHtml', () => {
	it( 'allows the HTML of core blocks', () => {
		for ( const html of [
			'Plain text',
			'<p class="has-text-align-left" style="color:red">One <strong>two</strong> <em>three</em></p>',
			'<a href="https://example.com/">Link</a> <a href="/page#top">Page</a> <a href="#note">Note</a>',
			'<a href="mailto:me@example.com">Mail</a> <a href="tel:+81-3-0000-0000">Call</a>',
			'<figure class="wp-block-image"><img src="photo.jpg" srcset="photo.jpg 1x, photo@2x.jpg 2x" alt=""></figure>',
			'<img src="data:image/png;base64,iVBORw0KGgo=" alt="">',
			'<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"></path></svg>',
		] ) {
			expect( findUnsafeHtml( html ) ).toEqual( [] );
		}
	} );

	it( 'finds elements that run or load code', () => {
		expect( descriptions( 'a<script>run()</script>' ) ).toEqual( [ 'the <script> element' ] );
		expect( descriptions( '<style>body{}</style>' ) ).toEqual( [ 'the <style> element' ] );
		expect( descriptions( '<iframe src="https://example.com/"></iframe>' ) ).toEqual( [
			'the <iframe> element',
		] );
		expect( descriptions( '<object data="x"></object><embed src="x">' ) ).toEqual( [
			'the <object> element',
			'the <embed> element',
		] );
		expect( descriptions( '<svg><script>run()</script></svg>' ) ).toEqual( [
			'the <script> element',
		] );
	} );

	it( 'finds event handler attributes', () => {
		expect( descriptions( '<img src="x" onerror="run()">' ) ).toEqual( [
			'the "onerror" attribute of <img>',
		] );
		expect( descriptions( '<svg onload="run()"></svg>' ) ).toEqual( [
			'the "onload" attribute of <svg>',
		] );
		expect( descriptions( '<strong ONMOUSEOVER="run()">x</strong>' ) ).toEqual( [
			'the "onmouseover" attribute of <strong>',
		] );
	} );

	it( 'finds URLs that run code, however they are written', () => {
		for ( const href of [
			'javascript:run()',
			'JavaScript:run()',
			' javascript:run()',
			'java\tscript:run()',
			'&#106;avascript:run()',
			'vbscript:run()',
			'data:text/html,<script>run()</script>',
		] ) {
			expect( findUnsafeHtml( `<a href="${ href }">x</a>` ) ).toHaveLength( 1 );
		}
		expect( findUnsafeHtml( '<svg><a xlink:href="javascript:run()">x</a></svg>' ) ).toHaveLength(
			1
		);
		expect( findUnsafeHtml( '<form action="javascript:run()"></form>' ) ).toHaveLength( 1 );
	} );
} );

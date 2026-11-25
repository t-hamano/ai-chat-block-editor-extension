/**
 * WordPress dependencies
 */
import { registerPlugin } from '@wordpress/plugins';

/**
 * Internal dependencies
 */
import { registerChangeHighlight } from './editor/highlight';
import Sidebar from './sidebar';

registerChangeHighlight();

registerPlugin( 'blocktune', {
	render: Sidebar,
} );

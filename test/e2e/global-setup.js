/**
 * External dependencies
 */
const { request } = require( '@playwright/test' );

/**
 * WordPress dependencies
 */
const { RequestUtils } = require( '@wordpress/e2e-test-utils-playwright' );
const wpGlobalSetup = require( '@wordpress/scripts/config/playwright/global-setup.js' );

/**
 * Signs in as WordPress does, then activates Blocktune, which the test
 * environment only maps so that the PHP unit tests can load it themselves.
 *
 * @param {import('@playwright/test').FullConfig} config
 */
module.exports = async function globalSetup( config ) {
	await wpGlobalSetup( config );

	const { storageState, baseURL } = config.projects[ 0 ].use;
	const requestContext = await request.newContext( { baseURL } );
	const requestUtils = new RequestUtils( requestContext, {
		storageStatePath: typeof storageState === 'string' ? storageState : undefined,
	} );

	await requestUtils.setupRest();
	await requestUtils.rest( {
		method: 'PUT',
		path: '/wp/v2/plugins/blocktune/blocktune',
		data: { status: 'active' },
	} );

	await requestContext.dispose();
};

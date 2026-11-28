/**
 * WordPress dependencies
 */
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test.describe( 'Without a connector', () => {
	test( 'should link to the Connectors screen', async ( { admin, page } ) => {
		await admin.createNewPost();
		await page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Blocktune', exact: true } )
			.click();

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await expect( sidebar.getByText( /No connector is set up\./ ) ).toBeVisible();
		await expect( sidebar.getByRole( 'link', { name: 'Connectors screen' } ) ).toHaveAttribute(
			'href',
			/options-connectors\.php$/
		);
		await expect( sidebar.getByRole( 'button', { name: 'Chat settings' } ) ).toBeDisabled();
	} );
} );

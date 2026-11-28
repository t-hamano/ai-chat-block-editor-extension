/**
 * Internal dependencies
 */
import { test, expect } from '../util';

test.describe( 'Without a connector', () => {
	test( 'should link to the Connectors screen', async ( { admin, blocktuneUtils } ) => {
		await admin.createNewPost();
		await blocktuneUtils.openSidebar();

		const { sidebar } = blocktuneUtils;
		await expect( sidebar.getByText( /No connector is set up\./ ) ).toBeVisible();
		await expect( sidebar.getByRole( 'link', { name: 'Connectors screen' } ) ).toHaveAttribute(
			'href',
			/options-connectors\.php$/
		);
		await expect( sidebar.getByRole( 'button', { name: 'Chat settings' } ) ).toBeDisabled();
	} );
} );

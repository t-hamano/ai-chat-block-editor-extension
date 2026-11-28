/**
 * WordPress dependencies
 */
import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test.describe( 'Chat', () => {
	test.beforeAll( async ( { requestUtils } ) => {
		await requestUtils.activatePlugin( 'blocktune-e2e-fake-provider' );
	} );

	test.beforeEach( async ( { admin, page } ) => {
		await admin.createNewPost();
		await page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Blocktune', exact: true } )
			.click();
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.deactivatePlugin( 'blocktune-e2e-fake-provider' );
	} );

	test( 'should add blocks to the document', async ( { editor, page, requestUtils } ) => {
		// The fake provider gives these answers in order, and forgets the requests it received.
		await requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: {
				answers: [
					{
						content: [
							{ type: 'text', text: 'I added a paragraph.' },
							{
								type: 'tool_use',
								id: 'toolu_e2e_1',
								name: 'edit_blocks',
								input: {
									action: 'append',
									markup:
										'<!-- wp:paragraph -->\n<p>Hello from the AI.</p>\n<!-- /wp:paragraph -->',
								},
							},
						],
						stop_reason: 'tool_use',
					},
				],
			},
		} );

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( 'Add a greeting.' );
		await sidebar.getByRole( 'button', { name: 'Send' } ).click();

		await expect( sidebar.getByText( 'Add a greeting.' ) ).toBeVisible();
		await expect( sidebar.getByText( 'I added a paragraph.' ) ).toBeVisible();
		await expect( sidebar.getByText( 'Edited the content.' ) ).toBeVisible();
		await expect( sidebar.getByText( '100 input tokens, 20 output tokens' ) ).toBeVisible();
		await expect
			.poll( () => editor.getBlocks() )
			.toMatchObject( [
				{ name: 'core/paragraph', attributes: { content: 'Hello from the AI.' } },
			] );

		// The site adds its own key on the server, and the message goes with it.
		const requests = await requestUtils.rest( { path: '/blocktune-e2e/v1/answers' } );
		expect( requests ).toHaveLength( 1 );
		expect( requests[ 0 ].api_key ).toBe( 'blocktune-e2e-key' );
		expect( JSON.stringify( requests[ 0 ].body.messages ) ).toContain( 'Add a greeting.' );
	} );

	test( 'should replace the selected block', async ( { editor, page, requestUtils } ) => {
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Original text.' },
		} );

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await expect( sidebar.getByText( '1 block selected' ) ).toBeVisible();

		await requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: {
				answers: [
					{
						content: [
							{ type: 'text', text: 'I rewrote the paragraph.' },
							{
								type: 'tool_use',
								id: 'toolu_e2e_1',
								name: 'edit_blocks',
								input: {
									action: 'replace',
									markup: '<!-- wp:paragraph -->\n<p>Rewritten text.</p>\n<!-- /wp:paragraph -->',
								},
							},
						],
						stop_reason: 'tool_use',
					},
				],
			},
		} );

		await sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( 'Rewrite this.' );
		await sidebar.getByRole( 'button', { name: 'Send' } ).click();

		await expect( sidebar.getByText( 'Edited the content.' ) ).toBeVisible();
		await expect
			.poll( () => editor.getBlocks() )
			.toMatchObject( [ { name: 'core/paragraph', attributes: { content: 'Rewritten text.' } } ] );

		// The selected block is sent with the message.
		const requests = await requestUtils.rest( { path: '/blocktune-e2e/v1/answers' } );
		expect( JSON.stringify( requests[ 0 ].body.messages ) ).toContain( 'Original text.' );
	} );

	test( 'should answer without editing', async ( { editor, page, requestUtils } ) => {
		await requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: { answers: [ { content: [ { type: 'text', text: 'The document is empty.' } ] } ] },
		} );

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( 'What is in the document?' );
		await sidebar.getByRole( 'button', { name: 'Send' } ).click();

		await expect( sidebar.getByText( 'The document is empty.' ) ).toBeVisible();
		await expect( sidebar.getByText( 'Edited the content.' ) ).toBeHidden();
		expect( await editor.getBlocks() ).toHaveLength( 0 );
	} );

	test( 'should show the error from the provider', async ( { page, requestUtils } ) => {
		await requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: { answers: [ { error: 'The model is overloaded.' } ] },
		} );

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( 'Add a greeting.' );
		await sidebar.getByRole( 'button', { name: 'Send' } ).click();

		await expect( sidebar.getByText( 'The model is overloaded.' ) ).toBeVisible();
	} );

	test( 'should start a new conversation', async ( { page, requestUtils } ) => {
		await requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: { answers: [ { content: [ { type: 'text', text: 'Hello.' } ] } ] },
		} );

		const sidebar = page.getByRole( 'region', { name: 'Editor settings' } );
		await sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( 'Hi.' );
		await sidebar.getByRole( 'button', { name: 'Send' } ).click();

		await expect( sidebar.getByText( 'Hello.' ) ).toBeVisible();

		await sidebar.getByRole( 'button', { name: 'New conversation' } ).click();

		await expect( sidebar.getByText( 'Hello.' ) ).toBeHidden();
		await expect(
			sidebar.getByText(
				'Ask the AI to write or edit. The selected blocks are sent with your message.'
			)
		).toBeVisible();
	} );
} );

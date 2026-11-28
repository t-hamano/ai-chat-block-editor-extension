/**
 * Internal dependencies
 */
import { test, expect, editAnswer, FAKE_API_KEY, FAKE_PROVIDER } from '../util';

test.describe( 'Chat', () => {
	test.beforeAll( async ( { requestUtils } ) => {
		await requestUtils.activatePlugin( FAKE_PROVIDER );
	} );

	test.beforeEach( async ( { admin, blocktuneUtils } ) => {
		await admin.createNewPost();
		await blocktuneUtils.openSidebar();
	} );

	test.afterAll( async ( { requestUtils } ) => {
		await requestUtils.deactivatePlugin( FAKE_PROVIDER );
	} );

	test( 'should add blocks to the document', async ( { editor, blocktuneUtils } ) => {
		await blocktuneUtils.setAnswers( [
			editAnswer( 'I added a paragraph.', {
				action: 'append',
				markup: '<!-- wp:paragraph -->\n<p>Hello from the AI.</p>\n<!-- /wp:paragraph -->',
			} ),
		] );

		await blocktuneUtils.send( 'Add a greeting.' );

		const { sidebar } = blocktuneUtils;
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
		const requests = await blocktuneUtils.getRequests();
		expect( requests ).toHaveLength( 1 );
		expect( requests[ 0 ].api_key ).toBe( FAKE_API_KEY );
		expect( JSON.stringify( requests[ 0 ].body.messages ) ).toContain( 'Add a greeting.' );
	} );

	test( 'should replace the selected block', async ( { editor, blocktuneUtils } ) => {
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Original text.' },
		} );

		const { sidebar } = blocktuneUtils;
		await expect( sidebar.getByText( '1 block selected' ) ).toBeVisible();

		await blocktuneUtils.setAnswers( [
			editAnswer( 'I rewrote the paragraph.', {
				action: 'replace',
				markup: '<!-- wp:paragraph -->\n<p>Rewritten text.</p>\n<!-- /wp:paragraph -->',
			} ),
		] );

		await blocktuneUtils.send( 'Rewrite this.' );

		await expect( sidebar.getByText( 'Edited the content.' ) ).toBeVisible();
		await expect
			.poll( () => editor.getBlocks() )
			.toMatchObject( [ { name: 'core/paragraph', attributes: { content: 'Rewritten text.' } } ] );

		// The selected block is sent with the message.
		const requests = await blocktuneUtils.getRequests();
		expect( JSON.stringify( requests[ 0 ].body.messages ) ).toContain( 'Original text.' );
	} );

	test( 'should answer without editing', async ( { editor, blocktuneUtils } ) => {
		await blocktuneUtils.setAnswers( [
			{ content: [ { type: 'text', text: 'The document is empty.' } ] },
		] );

		await blocktuneUtils.send( 'What is in the document?' );

		const { sidebar } = blocktuneUtils;
		await expect( sidebar.getByText( 'The document is empty.' ) ).toBeVisible();
		await expect( sidebar.getByText( 'Edited the content.' ) ).toBeHidden();
		expect( await editor.getBlocks() ).toHaveLength( 0 );
	} );

	test( 'should show the error from the provider', async ( { blocktuneUtils } ) => {
		await blocktuneUtils.setAnswers( [ { error: 'The model is overloaded.' } ] );

		await blocktuneUtils.send( 'Add a greeting.' );

		await expect( blocktuneUtils.sidebar.getByText( 'The model is overloaded.' ) ).toBeVisible();
	} );

	test( 'should start a new conversation', async ( { blocktuneUtils } ) => {
		await blocktuneUtils.setAnswers( [ { content: [ { type: 'text', text: 'Hello.' } ] } ] );

		await blocktuneUtils.send( 'Hi.' );

		const { sidebar } = blocktuneUtils;
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

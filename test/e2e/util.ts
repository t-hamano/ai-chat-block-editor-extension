/**
 * External dependencies
 */
import type { Page } from '@playwright/test';

/**
 * WordPress dependencies
 */
import { test as testBase, expect } from '@wordpress/e2e-test-utils-playwright';
import type { RequestUtils } from '@wordpress/e2e-test-utils-playwright';

/**
 * The plugin that answers for Anthropic in the tests.
 */
export const FAKE_PROVIDER = 'blocktune-e2e-fake-provider';

/**
 * The API key that the fake provider plugin gives Anthropic.
 */
export const FAKE_API_KEY = 'blocktune-e2e-key';

/**
 * A content block of an answer, as Anthropic sends it.
 */
type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input: Record< string, unknown > };

/**
 * An answer for the fake provider to give: what the model writes, or an
 * error the provider answers with.
 */
export type FakeAnswer =
	| {
			content: ContentBlock[];
			stop_reason?: string;
			usage?: { input_tokens: number; output_tokens: number };
	  }
	| { error: string; status?: number };

/**
 * A request the site sent to the provider.
 */
export type SentRequest = {
	api_key: string | null;
	body: {
		model: string;
		messages: { role: string; content: { type: string; text?: string }[] }[];
		[ key: string ]: unknown;
	};
};

/**
 * An answer that writes the text and makes one edit with the edit tool.
 *
 * @param text  What the model writes.
 * @param input The edit tool's input.
 */
export function editAnswer( text: string, input: Record< string, unknown > ): FakeAnswer {
	return {
		content: [
			{ type: 'text', text },
			{ type: 'tool_use', id: 'toolu_e2e_1', name: 'edit_blocks', input },
		],
		stop_reason: 'tool_use',
	};
}

export default class BlocktuneUtils {
	page: Page;
	requestUtils: RequestUtils;

	constructor( { page, requestUtils }: { page: Page; requestUtils: RequestUtils } ) {
		this.page = page;
		this.requestUtils = requestUtils;
	}

	/**
	 * Sets the answers the fake provider gives, in order, and forgets the
	 * requests it received.
	 *
	 * @param answers The answers.
	 */
	async setAnswers( answers: FakeAnswer[] ) {
		await this.requestUtils.rest( {
			method: 'POST',
			path: '/blocktune-e2e/v1/answers',
			data: { answers },
		} );
	}

	/**
	 * Gets the requests the fake provider received since the answers were set.
	 */
	async getRequests(): Promise< SentRequest[] > {
		return this.requestUtils.rest( { path: '/blocktune-e2e/v1/answers' } );
	}

	/**
	 * Opens the Blocktune sidebar.
	 */
	async openSidebar() {
		await this.page
			.getByRole( 'region', { name: 'Editor top bar' } )
			.getByRole( 'button', { name: 'Blocktune', exact: true } )
			.click();
		await expect( this.sidebar ).toBeVisible();
	}

	/**
	 * The Blocktune sidebar.
	 */
	get sidebar() {
		return this.page.getByRole( 'region', { name: 'Editor settings' } );
	}

	/**
	 * Sends a message in the chat.
	 *
	 * @param message The message.
	 */
	async send( message: string ) {
		await this.sidebar.getByRole( 'textbox', { name: 'Message' } ).fill( message );
		await this.sidebar.getByRole( 'button', { name: 'Send' } ).click();
	}
}

export const test = testBase.extend< { blocktuneUtils: BlocktuneUtils } >( {
	blocktuneUtils: async ( { page, requestUtils }, use ) => {
		await use( new BlocktuneUtils( { page, requestUtils } ) );
	},
} );

export { expect };

/**
 * External dependencies
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { createAnthropicPlatform } from '../providers/anthropic';
import { createFallbackPlatform } from '../providers/fallback';
import { createGeminiPlatform } from '../providers/gemini';
import { createOpenAiPlatform } from '../providers/openai';
import {
	PROVIDERS,
	chooseModel,
	createAutoPlatform,
	listProviderOptions,
	selectPlatform,
} from '../select';

vi.mock( '@wordpress/api-fetch', () => ( { default: vi.fn() } ) );
vi.mock( '../providers/anthropic', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	createAnthropicPlatform: vi.fn( () => ( { name: 'anthropic' } ) ),
} ) );
vi.mock( '../providers/openai', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	createOpenAiPlatform: vi.fn( () => ( { name: 'openai' } ) ),
} ) );
vi.mock( '../providers/gemini', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	createGeminiPlatform: vi.fn( () => ( { name: 'google' } ) ),
} ) );
vi.mock( '../providers/fallback', () => ( {
	createFallbackPlatform: vi.fn( () => ( { name: 'fallback' } ) ),
} ) );

const [ anthropic, openai, google ] = PROVIDERS;
const NO_KEY = { code: 'blocktune_no_api_key', message: 'No key.' };

const list = ( ...ids: string[] ) => ids.map( ( id ) => ( { id, name: id } ) );

/**
 * Answers the models route with a list, or an error, for each provider.
 *
 * @param answers The answer for each provider ID. Providers left out have no
 *                key, and are not listed as connected when the editor loads.
 */
function mockModels( answers: Record< string, unknown > ) {
	vi.stubGlobal( 'window', { blocktune: { providers: Object.keys( answers ) } } );
	vi.mocked( apiFetch ).mockImplementation( ( async ( { path }: { path: string } ) => {
		const provider = new URL( path, 'https://example.com' ).searchParams.get( 'provider' )!;
		const answer = answers[ provider ] ?? NO_KEY;
		if ( answer instanceof Error || ! Array.isArray( answer ) ) {
			throw answer;
		}
		return answer;
	} ) as never );
}

beforeEach( () => {
	vi.clearAllMocks();
} );

describe( 'chooseModel', () => {
	it( 'chooses the first recommended model in the list', () => {
		expect( chooseModel( anthropic, list( 'claude-haiku-5-5', anthropic.recommended[ 1 ] ) ) ).toBe(
			anthropic.recommended[ 1 ]
		);
	} );

	it( 'chooses another model that can chat when the recommended ones were retired', () => {
		expect(
			chooseModel(
				openai,
				list( 'gpt-4.1', 'text-embedding-3-large', 'gpt-image-2', 'gpt-7-chat-latest', 'gpt-7' )
			)
		).toBe( 'gpt-7' );
		expect( chooseModel( anthropic, list( 'claude-3-opus', 'claude-sonnet-6' ) ) ).toBe(
			'claude-sonnet-6'
		);
		expect( chooseModel( google, list( 'gemini-embedding-001', 'gemini-4-pro' ) ) ).toBe(
			'gemini-4-pro'
		);
	} );

	it( 'prefers a balanced model to the most expensive one when the recommended ones were retired', () => {
		expect( chooseModel( anthropic, list( 'claude-opus-6', 'claude-sonnet-6' ) ) ).toBe(
			'claude-sonnet-6'
		);
		expect( chooseModel( openai, list( 'gpt-7-astra', 'gpt-7-sol' ) ) ).toBe( 'gpt-7-sol' );
		expect( chooseModel( anthropic, list( 'claude-opus-6' ) ) ).toBe( 'claude-opus-6' );
	} );

	it( 'chooses the first recommended model without a list', () => {
		expect( chooseModel( google, null ) ).toBe( google.recommended[ 0 ] );
		expect( chooseModel( google, list( 'gemini-embedding-001' ) ) ).toBe( google.recommended[ 0 ] );
	} );
} );

describe( 'selectPlatform', () => {
	it( 'chooses providers in order, skipping the ones without a key', async () => {
		mockModels( { openai: list( 'gpt-7' ), google: list( 'gemini-4-pro' ) } );

		expect( await selectPlatform() ).toEqual( { name: 'openai' } );
		expect( createOpenAiPlatform ).toHaveBeenCalledWith( 'gpt-7' );
		expect( createAnthropicPlatform ).not.toHaveBeenCalled();
		expect( createGeminiPlatform ).not.toHaveBeenCalled();
	} );

	it( 'uses a provider with a key whose list could not be loaded', async () => {
		mockModels( { anthropic: { code: 'blocktune_provider_unreachable' } } );

		expect( await selectPlatform() ).toEqual( { name: 'anthropic' } );
		expect( createAnthropicPlatform ).toHaveBeenCalledWith( anthropic.recommended[ 0 ] );
	} );

	it( 'does not choose when the request did not reach the plugin', async () => {
		mockModels( { anthropic: { code: 'fetch_error' }, openai: list( 'gpt-7' ) } );

		await expect( selectPlatform() ).rejects.toEqual( { code: 'fetch_error' } );
		expect( createAnthropicPlatform ).not.toHaveBeenCalled();
		expect( createOpenAiPlatform ).not.toHaveBeenCalled();
	} );

	it( 'uses the provider and model the user chose', async () => {
		mockModels( { anthropic: list( 'claude-opus-6' ), openai: list( 'gpt-7', 'gpt-6' ) } );

		expect( await selectPlatform( { provider: 'openai', model: 'gpt-6' } ) ).toEqual( {
			name: 'openai',
		} );
		expect( createOpenAiPlatform ).toHaveBeenCalledWith( 'gpt-6' );
		expect( createAnthropicPlatform ).not.toHaveBeenCalled();
	} );

	it( 'chooses another model of the chosen provider when the model was retired', async () => {
		mockModels( { openai: list( 'gpt-7' ) } );

		await selectPlatform( { provider: 'openai', model: 'gpt-5-old' } );
		expect( createOpenAiPlatform ).toHaveBeenCalledWith( 'gpt-7' );
	} );

	it( 'keeps the chosen model when the list could not be loaded', async () => {
		mockModels( { openai: { code: 'blocktune_provider_unreachable' } } );

		await selectPlatform( { provider: 'openai', model: 'gpt-6' } );
		expect( createOpenAiPlatform ).toHaveBeenCalledWith( 'gpt-6' );
	} );

	it( 'chooses automatically when the chosen provider has no key', async () => {
		mockModels( { google: list( 'gemini-4-pro' ) } );

		expect( await selectPlatform( { provider: 'anthropic', model: 'claude-opus-6' } ) ).toEqual( {
			name: 'google',
		} );
		expect( createGeminiPlatform ).toHaveBeenCalledWith( 'gemini-4-pro' );
	} );

	it( 'does not ask for the models of the providers that had no key when the editor loaded', async () => {
		mockModels( { google: list( 'gemini-4-pro' ) } );

		await selectPlatform( { provider: 'anthropic', model: 'claude-opus-6' } );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/blocktune/v1/models?provider=google',
		} );
	} );

	it( 'chooses automatically when the chosen provider lost its key after the editor loaded', async () => {
		mockModels( { anthropic: NO_KEY, google: list( 'gemini-4-pro' ) } );

		expect( await selectPlatform( { provider: 'anthropic', model: 'claude-opus-6' } ) ).toEqual( {
			name: 'google',
		} );
	} );

	it( 'falls back to the AI Client with the same order without a key', async () => {
		mockModels( {} );

		expect( await selectPlatform() ).toEqual( { name: 'fallback' } );
		const models = vi.mocked( createFallbackPlatform ).mock.calls[ 0 ][ 0 ]!;
		expect( models[ 0 ] ).toEqual( [ 'anthropic', anthropic.recommended[ 0 ] ] );
		expect( models.map( ( [ provider ] ) => provider ) ).toEqual(
			PROVIDERS.flatMap( ( provider ) => provider.recommended.map( () => provider.id ) )
		);
	} );
} );

describe( 'listProviderOptions', () => {
	it( 'lists the providers with a key, and the models that can chat, recommended first', async () => {
		mockModels( {
			openai: list( 'gpt-image-2', 'gpt-7', openai.recommended[ 1 ], 'gpt-4.1' ),
			google: { code: 'blocktune_provider_unreachable' },
		} );

		expect( await listProviderOptions() ).toEqual( [
			{
				id: 'openai',
				name: 'OpenAI',
				usageUrl: openai.usageUrl,
				models: [ openai.recommended[ 1 ], 'gpt-7' ],
			},
			{ id: 'google', name: 'Google', usageUrl: google.usageUrl, models: google.recommended },
		] );
	} );
} );

describe( 'createAutoPlatform', () => {
	it( 'chooses once, when the first message is sent', async () => {
		const chat = vi.fn();
		vi.mocked( createGeminiPlatform ).mockReturnValue( { chat } );
		mockModels( { google: list( 'gemini-4-pro' ) } );

		const ai = createAutoPlatform();
		expect( apiFetch ).not.toHaveBeenCalled();

		const request = {} as Parameters< typeof chat >[ 0 ];
		await ai.chat( request );
		await ai.chat( request );

		expect( chat ).toHaveBeenCalledTimes( 2 );
		expect( chat ).toHaveBeenCalledWith( request );
		expect( createGeminiPlatform ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'chooses again when the user chooses another model', async () => {
		const chat = vi.fn();
		vi.mocked( createOpenAiPlatform ).mockReturnValue( { chat } );
		mockModels( { openai: list( 'gpt-7', 'gpt-6' ) } );

		let choice = { provider: 'openai', model: 'gpt-7' };
		const ai = createAutoPlatform( () => choice );
		const request = {} as Parameters< typeof chat >[ 0 ];
		await ai.chat( request );
		await ai.chat( request );
		choice = { provider: 'openai', model: 'gpt-6' };
		await ai.chat( request );

		expect( vi.mocked( createOpenAiPlatform ).mock.calls ).toEqual( [ [ 'gpt-7' ], [ 'gpt-6' ] ] );
	} );

	it( 'chooses again when the choice could not be made', async () => {
		const chat = vi.fn();
		vi.mocked( createGeminiPlatform ).mockReturnValue( { chat } );
		mockModels( { anthropic: { code: 'fetch_error' } } );

		const ai = createAutoPlatform();
		const request = {} as Parameters< typeof chat >[ 0 ];
		await expect( ai.chat( request ) ).rejects.toEqual( { code: 'fetch_error' } );

		mockModels( { google: list( 'gemini-4-pro' ) } );
		await ai.chat( request );

		expect( chat ).toHaveBeenCalledWith( request );
	} );
} );

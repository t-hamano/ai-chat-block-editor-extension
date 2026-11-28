/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import type { AiPlatform } from '.';
import { ANTHROPIC_MODEL, createAnthropicPlatform } from './anthropic';
import { createFallbackPlatform } from './fallback';
import { GEMINI_MODEL, createGeminiPlatform } from './gemini';
import { OPENAI_MODEL, createOpenAiPlatform } from './openai';

/**
 * A provider the plugin streams answers from.
 */
type Provider = {
	/**
	 * The provider ID, as the AI Client and the relay name it.
	 */
	id: string;
	/**
	 * The provider's name, shown to the user.
	 */
	name: string;
	/**
	 * The provider's page that shows the usage it bills for.
	 */
	usageUrl: string;
	/**
	 * The models to use, best first. They balance quality and price, so
	 * that the assistant does not use the provider's most expensive model
	 * unless the user chooses it.
	 */
	recommended: string[];
	/**
	 * Whether a model is preferred when none of the recommended models is
	 * in the provider's list, to keep away from the most expensive models.
	 * Without it, any model that can chat is preferred.
	 */
	affordable?: ( model: string ) => boolean;
	/**
	 * Whether a model from the provider's list can chat, for when none of
	 * the recommended models is in it. Older models are left out, because
	 * they cannot write as many tokens as the adapters ask for.
	 */
	canChat: ( model: string ) => boolean;
	create: ( getPostId: () => number, model: string ) => AiPlatform;
};

/**
 * The providers in the order they are chosen in.
 */
export const PROVIDERS: Provider[] = [
	{
		id: 'anthropic',
		name: 'Anthropic',
		usageUrl: 'https://platform.claude.com/usage',
		recommended: [ ANTHROPIC_MODEL, 'claude-sonnet-5' ],
		canChat: ( model ) => /^claude-(?:opus|sonnet)-(?:[4-9]|\d{2,})/.test( model ),
		affordable: ( model ) => model.startsWith( 'claude-sonnet-' ),
		create: createAnthropicPlatform,
	},
	{
		id: 'openai',
		name: 'OpenAI',
		usageUrl: 'https://platform.openai.com/usage',
		recommended: [ OPENAI_MODEL, 'gpt-6-sol', 'gpt-5' ],
		// OpenAI also lists models for images, audio, and search, and the
		// models ChatGPT uses, which cannot write as many tokens as the
		// adapters ask for.
		canChat: ( model ) =>
			/^gpt-(?:[5-9]|\d{2,})/.test( model ) &&
			! /image|audio|realtime|tts|transcribe|search|chat/.test( model ),
		affordable: ( model ) => /-sol\b/.test( model ),
		create: createOpenAiPlatform,
	},
	{
		id: 'google',
		name: 'Google',
		usageUrl: 'https://aistudio.google.com/usage',
		recommended: [ GEMINI_MODEL, 'gemini-2.5-pro' ],
		canChat: ( model ) =>
			/^gemini-(?:2\.5|[3-9]|\d{2,})/.test( model ) &&
			! /image|audio|tts|embedding|live/.test( model ),
		create: createGeminiPlatform,
	},
];

/**
 * A model from a provider's model list.
 */
export type Model = { id: string; name: string };

/**
 * Chooses the model of a provider: the first recommended model in its
 * list, or when they were all retired, the first other model in the list
 * that can chat, preferring the affordable ones.
 *
 * @param provider The provider.
 * @param models   The provider's models, or `null` when the list could not
 *                 be loaded.
 * @return The model ID.
 */
export function chooseModel( provider: Provider, models: Model[] | null ): string {
	if ( ! models ) {
		return provider.recommended[ 0 ];
	}
	const ids = models.map( ( model ) => model.id );
	return (
		provider.recommended.find( ( model ) => ids.includes( model ) ) ??
		ids.find(
			( model ) => provider.canChat( model ) && ( provider.affordable?.( model ) ?? true )
		) ??
		ids.find( provider.canChat ) ??
		provider.recommended[ 0 ]
	);
}

/**
 * Loads a provider's models.
 *
 * @param  provider The provider ID.
 * @return The models; `null` when the provider could not list them, or
 *         `false` when the provider has no API key.
 * @throws {Error} When the request did not reach the plugin, so it is not known
 *                 whether the provider has a key.
 */
async function loadModels( provider: string ): Promise< Model[] | null | false > {
	// The route would answer `blocktune_no_api_key`, which the browser logs as
	// an error, so a provider that had no key when the editor loaded is not asked.
	if ( ! window.blocktune.providers.includes( provider ) ) {
		return false;
	}
	try {
		return await apiFetch< Model[] >( {
			path: `/blocktune/v1/models?provider=${ provider }`,
		} );
	} catch ( error ) {
		// The route answers this when the provider has no key in Connectors.
		const code = ( error as { code?: unknown } )?.code;
		if ( code === 'blocktune_no_api_key' ) {
			return false;
		}
		// The plugin's other errors mean the provider has a key but did not answer.
		if ( typeof code === 'string' && code.startsWith( 'blocktune_' ) ) {
			return null;
		}
		throw error;
	}
}

/**
 * A provider and model the user chose to answer with, instead of the ones
 * `selectPlatform()` chooses.
 */
export type ModelChoice = { provider: string; model: string };

/**
 * A provider the user can choose, with the models it can chat with.
 */
export type ProviderOption = {
	id: string;
	name: string;
	usageUrl: string;
	/**
	 * The models, recommended ones first. When the provider could not list
	 * its models, only the recommended ones.
	 */
	models: string[];
};

/**
 * Lists the providers that have an API key, in the order they are chosen
 * in, with the models the user can choose from.
 *
 * @return The providers.
 */
export async function listProviderOptions(): Promise< ProviderOption[] > {
	const options = await Promise.all(
		PROVIDERS.map( async ( provider ): Promise< ProviderOption | null > => {
			const models = await loadModels( provider.id );
			if ( models === false ) {
				return null;
			}
			const ids = models ? models.map( ( model ) => model.id ) : provider.recommended;
			const recommended = provider.recommended.filter( ( model ) => ids.includes( model ) );
			const others = ids.filter(
				( model ) => provider.canChat( model ) && ! recommended.includes( model )
			);
			return {
				id: provider.id,
				name: provider.name,
				usageUrl: provider.usageUrl,
				models: [ ...recommended, ...others ],
			};
		} )
	);
	return options.filter( ( option ) => option !== null );
}

/**
 * Chooses how the assistant answers. The provider and model the user chose
 * come first, while the provider has an API key. When the model is no longer
 * in the provider's list, `chooseModel()` picks another one.
 *
 * Otherwise, the answer comes from the first provider in `PROVIDERS` that has
 * an API key, with its model from `chooseModel()`. Without any of them, the
 * answer comes through the AI Client, which is given the same order to choose
 * from.
 *
 * @param getPostId Returns the ID of the post being edited.
 * @param choice    The provider and model the user chose, if any.
 * @return The connection.
 */
export async function selectPlatform(
	getPostId: () => number,
	choice?: ModelChoice | null
): Promise< AiPlatform > {
	const chosen = choice && PROVIDERS.find( ( provider ) => provider.id === choice.provider );
	if ( chosen ) {
		const models = await loadModels( chosen.id );
		if ( models !== false ) {
			const model =
				! models || models.some( ( { id } ) => id === choice!.model )
					? choice!.model
					: chooseModel( chosen, models );
			return chosen.create( getPostId, model );
		}
	}
	for ( const provider of PROVIDERS ) {
		const models = await loadModels( provider.id );
		if ( models !== false ) {
			return provider.create( getPostId, chooseModel( provider, models ) );
		}
	}
	return createFallbackPlatform(
		getPostId,
		PROVIDERS.flatMap( ( provider ) =>
			provider.recommended.map( ( model ): [ string, string ] => [ provider.id, model ] )
		)
	);
}

/**
 * Connects the AI assistant to the provider and model `selectPlatform()`
 * chooses. The choice is made when the first message is sent, and kept
 * until the user chooses another provider or model. When it could not be
 * made, the next message tries again.
 *
 * @param getPostId Returns the ID of the post being edited.
 * @param getChoice Returns the provider and model the user chose, if any.
 * @return The connection.
 */
export function createAutoPlatform(
	getPostId: () => number,
	getChoice: () => ModelChoice | null = () => null
): AiPlatform {
	let platform: Promise< AiPlatform > | undefined;
	let platformChoice: string | undefined;
	return {
		async chat( request ) {
			const choice = getChoice();
			const key = JSON.stringify( choice );
			if ( key !== platformChoice ) {
				platform = undefined;
				platformChoice = key;
			}
			platform ??= selectPlatform( getPostId, choice ).catch( ( error ) => {
				platform = undefined;
				throw error;
			} );
			return ( await platform ).chat( request );
		},
	};
}

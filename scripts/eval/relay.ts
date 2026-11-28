/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { addUsage, countRetries, readAnswerUsage, readStreamUsage, type Usage } from './usage';

/**
 * Where the plugin's relay sends Anthropic's requests, as in
 * `classes/class-relay.php`.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * The token limit the relay sets on every request, as `MAX_TOKENS` in
 * `classes/class-relay.php`.
 */
const MAX_TOKENS = 64000;

type ChatData = { provider: string; stream: boolean; body: Record< string, unknown > };

/**
 * What the relay counted while the model answered.
 */
export type RelayRecord = {
	usage: Usage;
	/**
	 * The failed tool calls sent back to the model to try again.
	 */
	retries: number;
	/**
	 * The error statuses Anthropic answered with, which say nothing about
	 * the plugin, such as for a wrong API key or an overloaded model.
	 */
	errors: string[];
	/**
	 * Reads the usage of the answers still being read.
	 */
	settle: () => Promise< void >;
};

/**
 * Answers the platform's requests to the plugin's relay the way the relay
 * does, with the API key from the environment, so the evaluation runs the
 * plugin's own Anthropic adapter without WordPress. The usage of each
 * answer is read from a copy of its stream.
 *
 * @param apiKey The Anthropic API key.
 * @return What the relay counts.
 */
export function setUpRelay( apiKey: string ): RelayRecord {
	const pending: Promise< void >[] = [];
	const record: RelayRecord = {
		usage: {
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
			requests: 0,
		},
		retries: 0,
		errors: [],
		settle: async () => {
			await Promise.all( pending );
		},
	};

	apiFetch.setFetchHandler( async ( options ) => {
		const data = options.data as ChatData;
		if ( data.provider !== 'anthropic' ) {
			throw new Error( `The evaluation only sends requests to Anthropic, not ${ data.provider }.` );
		}
		record.retries += countRetries( data.body );
		const response = await fetch( ANTHROPIC_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'anthropic-version': '2023-06-01',
				'x-api-key': apiKey,
			},
			body: JSON.stringify( { ...data.body, max_tokens: MAX_TOKENS, stream: data.stream } ),
			signal: options.signal,
		} );
		// The platform reads an error status from the response apiFetch rejects with.
		if ( ! response.ok ) {
			record.usage.requests++;
			record.errors.push( `${ response.status } ${ await response.clone().text() }` );
			throw response;
		}
		if ( ! response.body ) {
			return response;
		}
		const [ forPlatform, forUsage ] = response.body.tee();
		// The platform asks for the whole answer at once when streaming does not work.
		const read = data.stream
			? readStreamUsage
			: ( text: string ) => readAnswerUsage( JSON.parse( text ) );
		pending.push(
			new Response( forUsage ).text().then(
				( text ) => addUsage( record.usage, read( text ) ),
				() => addUsage( record.usage, readStreamUsage( '' ) )
			)
		);
		return new Response( forPlatform, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		} );
	} );
	return record;
}

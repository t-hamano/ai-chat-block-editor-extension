/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { readSse } from './sse';

/**
 * How long to wait for the next piece of an answer, in milliseconds. The
 * relay waits up to 300 seconds for the provider, so this only ends
 * connections that stopped without closing.
 */
export const IDLE_TIMEOUT = 330_000;

/**
 * The event the relay adds when the provider's answer stopped partway.
 * Its data is `{ message }`.
 */
export const RELAY_ERROR_EVENT = 'ai_chat_block_editor_extension_error';

/**
 * An event of a provider's answer, with its data read from JSON.
 */
export type AnswerEvent = {
	event: string;
	data: any;
};

/**
 * The error for an answer that stopped before it was finished.
 *
 * @return The error.
 */
export function connectionLost(): Error {
	return new Error(
		__(
			'The connection was lost before the answer was finished.',
			'ai-chat-block-editor-extension'
		)
	);
}

/**
 * Reads the events of a provider's answer, with their data read from JSON.
 *
 * An event that is not JSON was cut off, so the answer ends there, with the
 * relay's message when it says why.
 *
 * @param body   The response body.
 * @param signal Stops reading when aborted.
 */
export async function* readEvents(
	body: ReadableStream< Uint8Array >,
	signal?: AbortSignal
): AsyncGenerator< AnswerEvent > {
	let cutOff = false;
	for await ( const { event, data } of readSse( body, signal ) ) {
		if ( event === RELAY_ERROR_EVENT ) {
			let message: unknown;
			try {
				message = JSON.parse( data )?.message;
			} catch {
				// Fall back to the general message below.
			}
			throw typeof message === 'string' && message ? new Error( message ) : connectionLost();
		}
		if ( cutOff ) {
			break;
		}
		let payload: unknown;
		try {
			payload = JSON.parse( data );
		} catch {
			// Wait for the next event, which may be the relay's message.
			cutOff = true;
			continue;
		}
		yield { event, data: payload };
	}
	if ( cutOff ) {
		throw connectionLost();
	}
}

/**
 * How long the first piece of a streamed answer may take, in milliseconds,
 * before an answer that then arrives all at once counts as held back.
 */
const HELD_WAIT = 2000;

/**
 * How quickly the pieces of a held back answer arrive after the first one,
 * in milliseconds.
 */
const HELD_BURST = 100;

/**
 * Whether the site holds streamed answers back until they are finished, so
 * answers are asked for all at once instead. It is kept until the editor
 * reloads.
 */
let streamsHeld = false;

/**
 * Streams answers again, as when the editor loads.
 */
export function resetStreamDetection() {
	streamsHeld = false;
}

/**
 * A request for the plugin's relay to send to a provider.
 */
export type RelayRequest = {
	/**
	 * The provider ID.
	 */
	provider: string;
	postId: number;
	/**
	 * The request body for the provider.
	 */
	body: unknown;
	signal: AbortSignal;
	/**
	 * Reads the message of an error response.
	 */
	readError: ( response: Response ) => Promise< string >;
	/**
	 * Turns the provider's whole answer, when it is not streamed, into the
	 * events of a streamed one.
	 */
	toEvents: ( answer: unknown ) => AnswerEvent[];
};

/**
 * The error for a streamed answer that never started, so the request can
 * be sent again for the whole answer at once.
 */
class StreamFailed extends Error {}

/**
 * Turns what apiFetch rejected with into an error to show.
 *
 * @param error What apiFetch rejected with.
 * @return The error.
 */
function toRequestError( error: unknown ): Error {
	if ( error instanceof Error || error instanceof DOMException ) {
		return error;
	}
	// apiFetch rejects with `{ code, message }` when the request fails.
	const message = ( error as { message?: unknown } )?.message;
	return new Error(
		typeof message === 'string' && message
			? message
			: __( 'The answer could not be loaded.', 'ai-chat-block-editor-extension' )
	);
}

/**
 * Whether a response came from WordPress or the provider, rather than from
 * a server in between, such as a proxy that gave up.
 *
 * @param response The response.
 * @param type     The content type the answer has.
 */
function hasType( response: Response, type: string ): boolean {
	const contentType = response.headers.get( 'content-type' );
	// Responses made in tests have no content type.
	return ! contentType || contentType.includes( type );
}

/**
 * Sends a request through the plugin's relay, and reads the provider's
 * streamed answer as it arrives.
 *
 * Rejects with `StreamFailed` when the answer fails before anything of it
 * arrived.
 *
 * @param request The request.
 */
async function* stream( request: RelayRequest ): AsyncGenerator< AnswerEvent > {
	const { provider, postId, body, signal, readError } = request;
	const watch = new AbortController();
	let timedOut = false;
	let timer: ReturnType< typeof setTimeout > | undefined;
	const wait = () => {
		clearTimeout( timer );
		timer = setTimeout( () => {
			timedOut = true;
			watch.abort();
		}, IDLE_TIMEOUT );
	};
	const stop = () => watch.abort();
	signal.addEventListener( 'abort', stop );
	// Why the answer stopped, when the user or the timer stopped it.
	const stopped = () => {
		if ( signal.aborted ) {
			return new DOMException( 'The answer was stopped.', 'AbortError' );
		}
		return timedOut
			? new Error(
					__( 'The answer took too long, so it was stopped.', 'ai-chat-block-editor-extension' )
				)
			: null;
	};
	let started = false;

	try {
		wait();
		let response: Response;
		try {
			response = await apiFetch< Response, false >( {
				path: '/ai-chat-block-editor-extension/v1/chat',
				method: 'POST',
				data: { provider, post_id: postId, stream: true, body },
				parse: false,
				signal: watch.signal,
			} );
		} catch ( error ) {
			// With `parse: false`, an error status rejects with the response
			// itself. An error that is not JSON came from a server in between.
			if ( error instanceof Response ) {
				if ( ! hasType( error, 'json' ) ) {
					throw new StreamFailed( await readError( error ) );
				}
				throw new Error( await readError( error ) );
			}
			throw stopped() ?? toRequestError( error );
		}

		if ( ! response.body || ! hasType( response, 'event-stream' ) ) {
			throw new StreamFailed(
				__( 'The answer could not be read.', 'ai-chat-block-editor-extension' )
			);
		}
		try {
			for await ( const event of readEvents( response.body, watch.signal ) ) {
				wait();
				started = true;
				yield event;
			}
		} catch ( error ) {
			// Reading fails with a `TypeError` when the connection drops.
			const reason = stopped();
			if ( reason || ! ( error instanceof TypeError ) ) {
				throw reason ?? error;
			}
			throw started ? connectionLost() : new StreamFailed();
		}
		// Reading also ends without an error when it was stopped.
		const reason = stopped() ?? ( started ? null : new StreamFailed() );
		if ( reason ) {
			throw reason;
		}
	} finally {
		clearTimeout( timer );
		signal.removeEventListener( 'abort', stop );
	}
}

/**
 * Sends a request through the plugin's relay for the provider's whole
 * answer at once, and reads it as the events of a streamed one.
 *
 * @param request The request.
 */
async function* answerAtOnce( request: RelayRequest ): AsyncGenerator< AnswerEvent > {
	const { provider, postId, body, signal, readError, toEvents } = request;
	// The whole answer comes as one piece, so it may take as long as the
	// wait for one piece of a streamed answer.
	const watch = new AbortController();
	let timedOut = false;
	const timer = setTimeout( () => {
		timedOut = true;
		watch.abort();
	}, IDLE_TIMEOUT );
	const stop = () => watch.abort();
	signal.addEventListener( 'abort', stop );
	let answer: unknown;
	try {
		const response = await apiFetch< Response, false >( {
			path: '/ai-chat-block-editor-extension/v1/chat',
			method: 'POST',
			data: { provider, post_id: postId, stream: false, body },
			parse: false,
			signal: watch.signal,
		} );
		answer = await response.json();
	} catch ( error ) {
		if ( signal.aborted ) {
			throw new DOMException( 'The answer was stopped.', 'AbortError' );
		}
		if ( timedOut ) {
			throw new Error(
				__( 'The answer took too long, so it was stopped.', 'ai-chat-block-editor-extension' )
			);
		}
		if ( error instanceof Response ) {
			throw new Error( await readError( error ) );
		}
		if ( error instanceof SyntaxError ) {
			throw new Error( __( 'The answer could not be read.', 'ai-chat-block-editor-extension' ) );
		}
		throw toRequestError( error );
	} finally {
		clearTimeout( timer );
		signal.removeEventListener( 'abort', stop );
	}
	yield* toEvents( answer );
}

/**
 * Sends a request through the plugin's relay, and reads the provider's
 * answer as it arrives.
 *
 * When the streamed answer fails before anything of it arrived, the request
 * is sent again for the whole answer at once. When the site holds streamed
 * answers back until they are finished, later answers are asked for all at
 * once.
 *
 * When nothing arrives for `IDLE_TIMEOUT`, the answer is stopped. A lost
 * connection rejects with a message that says so. When `signal` is aborted,
 * rejects with an `AbortError`.
 *
 * @param request The request.
 */
export async function* requestAnswer( request: RelayRequest ): AsyncGenerator< AnswerEvent > {
	if ( ! streamsHeld ) {
		const sent = Date.now();
		let first: number | undefined;
		let last = 0;
		let count = 0;
		try {
			for await ( const event of stream( request ) ) {
				last = Date.now();
				first ??= last;
				count++;
				yield event;
			}
		} catch ( error ) {
			if ( ! ( error instanceof StreamFailed ) ) {
				throw error;
			}
			streamsHeld = true;
		}
		if ( ! streamsHeld ) {
			// An answer that arrives all at once after a wait was held back.
			if ( count > 2 && first! - sent >= HELD_WAIT && last - first! <= HELD_BURST ) {
				streamsHeld = true;
			}
			return;
		}
	}
	yield* answerAtOnce( request );
}

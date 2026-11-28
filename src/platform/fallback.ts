/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import type { AiChatRequest, AiMessage, AiPlatform } from '.';
import { READ_TOOLS } from './read-tools';
import { EDIT_TOOL, describeApplied, runToolLoop } from './tools';

/**
 * The edit tool, as a function declaration of the AI Client. It is made
 * from the shared tool, so every provider gets the same tool.
 */
export const FALLBACK_EDIT_TOOL = {
	name: EDIT_TOOL.name,
	description: EDIT_TOOL.description,
	parameters: EDIT_TOOL.input_schema,
};

/**
 * The read tools, as function declarations of the AI Client.
 */
export const FALLBACK_READ_TOOLS = READ_TOOLS.map( ( tool ) => ( {
	name: tool.name,
	description: tool.description,
	parameters: tool.input_schema,
} ) );

/**
 * A part of a message, as the AI Client has it: text, a function call, or a
 * function's response. Text on the `thought` channel is the model's
 * reasoning.
 */
export type FallbackPart = {
	channel?: string;
	text?: string;
	functionCall?: { id?: string; name?: string; args?: unknown };
	functionResponse?: { id?: string; name?: string; response?: unknown };
	[ key: string ]: unknown;
};

export type FallbackMessage = { role: 'user' | 'model'; parts: FallbackPart[] };

/**
 * What the fallback route answers.
 */
export type FallbackAnswer = {
	message: FallbackMessage;
	finishReason: string;
	usage?: { inputTokens?: number; outputTokens?: number };
	provider?: string;
	model?: string;
};

/**
 * Converts the conversation into the AI Client's messages.
 *
 * Earlier answers are sent as their text and edits, with the reference IDs
 * of the blocks the edits added, and messages of the
 * same role in a row are joined, so the roles take turns.
 *
 * @param messages The conversation.
 * @return The messages.
 */
export function toFallbackMessages( messages: AiMessage[] ): FallbackMessage[] {
	const result: FallbackMessage[] = [];
	const push = ( role: FallbackMessage[ 'role' ], parts: FallbackPart[] ) => {
		if ( ! parts.length ) {
			return;
		}
		const last = result[ result.length - 1 ];
		if ( last?.role === role ) {
			last.parts.push( ...parts );
		} else {
			result.push( { role, parts } );
		}
	};
	messages.forEach( ( message, index ) => {
		if ( message.role === 'user' ) {
			push( 'user', [ { text: message.text } ] );
			return;
		}
		const edits = message.edits ?? [];
		const ids = edits.map( ( _, number ) => `call_edit_${ index }_${ number }` );
		push( 'model', [
			...( message.text ? [ { text: message.text } ] : [] ),
			...edits.map( ( edit, number ) => ( {
				functionCall: { id: ids[ number ], name: EDIT_TOOL.name, args: edit },
			} ) ),
		] );
		push(
			'user',
			ids.map( ( id, number ) => ( {
				functionResponse: {
					id,
					name: EDIT_TOOL.name,
					response: describeApplied( message.editRefs?.[ number ] ),
				},
			} ) )
		);
	} );
	return result;
}

/**
 * Reports the answer through `onEvent`, and throws when it ended early.
 *
 * The route answers all at once, so the text comes as one piece.
 *
 * @param answer  The answer.
 * @param onEvent Called for each event of the answer.
 * @return The function calls in the answer.
 */
export function readFallbackAnswer(
	answer: FallbackAnswer,
	onEvent: AiChatRequest[ 'onEvent' ]
): FallbackPart[] {
	const parts = answer?.message?.parts;
	if ( ! Array.isArray( parts ) ) {
		throw new Error( __( 'The answer could not be read.', 'blocktune' ) );
	}

	if ( answer.usage ) {
		onEvent( {
			type: 'usage',
			usage: {
				inputTokens: answer.usage.inputTokens ?? 0,
				outputTokens: answer.usage.outputTokens ?? 0,
			},
		} );
	}

	switch ( answer.finishReason ) {
		case 'content_filter':
			throw new Error( __( 'The model declined to answer.', 'blocktune' ) );
		case 'length':
			// A function call may be cut off, so no edit is applied.
			throw new Error( __( 'The answer was cut off because it was too long.', 'blocktune' ) );
		case 'error':
			throw new Error( __( 'The answer could not be loaded.', 'blocktune' ) );
	}

	const text = parts
		.filter( ( part ) => part.channel !== 'thought' && typeof part.text === 'string' )
		.map( ( part ) => part.text )
		.join( '' );
	if ( text ) {
		onEvent( { type: 'text', text } );
	}

	return parts.filter( ( part ) => part.functionCall );
}

/**
 * Connects the AI assistant to whichever provider the AI Client in
 * WordPress has set up, through the plugin's fallback route. The AI Client
 * adds the key on the server.
 *
 * The route does not stream, so each answer arrives at once.
 *
 * @param models The preferred models in order, as [provider ID, model ID]
 *               pairs. The AI Client chooses when none of them is
 *               available.
 * @return The connection.
 */
export function createFallbackPlatform( models: [ string, string ][] = [] ): AiPlatform {
	return {
		chat( { system, messages, onEvent, read, signal } ) {
			const conversation = toFallbackMessages( messages );
			return runToolLoop(
				{
					readAnswer: async ( onAnswerEvent ) => {
						let answer: FallbackAnswer;
						try {
							answer = await apiFetch< FallbackAnswer >( {
								path: '/blocktune/v1/fallback',
								method: 'POST',
								data: {
									system,
									messages: conversation,
									tools: [ FALLBACK_EDIT_TOOL, ...FALLBACK_READ_TOOLS ],
									models,
								},
								signal,
							} );
						} catch ( error ) {
							if ( ( error as Error )?.name === 'AbortError' ) {
								throw error;
							}
							// apiFetch rejects with the parsed error, `{ code, message }`.
							const message = ( error as { message?: unknown } )?.message;
							throw new Error(
								typeof message === 'string' && message
									? message
									: __( 'The answer could not be loaded.', 'blocktune' )
							);
						}
						const calls = readFallbackAnswer( answer, onAnswerEvent );
						return { message: answer.message, calls };
					},
					getCalls: ( { calls } ) =>
						calls.length
							? calls.map( ( part ) => {
									const call = part.functionCall ?? {};
									return { id: call.id, name: call.name, input: call.args };
								} )
							: null,
					toResult: ( call, { text } ): FallbackPart => ( {
						functionResponse: { id: call.id, name: call.name, response: text },
					} ),
					// The model's message goes back unchanged, with its reasoning, so
					// the model goes on from where it stopped.
					append: ( answer, results ) => {
						conversation.push( answer.message, { role: 'user', parts: results } );
					},
				},
				{ onEvent, read }
			);
		},
	};
}

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import type { AiChatRequest, AiMessage, AiPlatform, AiUsage } from '.';
import { READ_TOOLS, getToolActivity } from './read-tools';
import { EDIT_TOOL, describeApplied, runToolLoop } from './tools';
import { connectionLost, requestAnswer, type AnswerEvent } from './transport';

/**
 * The model that answers when no other model is chosen.
 */
export const GEMINI_MODEL = 'gemini-3.1-pro-preview';

/**
 * How much the model thinks on an answer. Editing blocks does not need the
 * provider's default of `high`, and a lower level answers faster and costs
 * less. It is only sent to `GEMINI_MODEL`, because the levels other models
 * take differ, and a model rejects one it does not take.
 */
export const GEMINI_THINKING_LEVEL = 'low';

/**
 * The edit tool, as a function declaration of Google's Gemini API. It is
 * made from the shared tool, so every provider gets the same tool.
 */
export const GEMINI_EDIT_TOOL = {
	name: EDIT_TOOL.name,
	description: EDIT_TOOL.description,
	parameters: EDIT_TOOL.input_schema,
};

/**
 * The read tools, as function declarations of Google's Gemini API.
 */
export const GEMINI_READ_TOOLS = READ_TOOLS.map( ( tool ) => ( {
	name: tool.name,
	description: tool.description,
	parameters: tool.input_schema,
} ) );

/**
 * A part of a Gemini message: text, the model's thought, a function call, or
 * a function's response. Any part may carry a `thoughtSignature`.
 */
type GeminiPart = {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { id?: string; name?: string; args?: unknown };
	functionResponse?: { id?: string; name: string; response: Record< string, unknown > };
	[ key: string ]: unknown;
};

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

/**
 * Converts the conversation into Gemini's contents.
 *
 * Earlier answers are sent as their text and edits, with the reference IDs
 * of the blocks the edits added. The model's thoughts are not kept. Gemini only checks thought signatures in the current turn,
 * which starts with the user's new message, so the history needs none.
 *
 * @param messages The conversation.
 * @return The contents.
 */
export function toGeminiContents( messages: AiMessage[] ): GeminiContent[] {
	const result: GeminiContent[] = [];
	const push = ( role: GeminiContent[ 'role' ], parts: GeminiPart[] ) => {
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
	messages.forEach( ( message ) => {
		if ( message.role === 'user' ) {
			push( 'user', [ { text: message.text } ] );
			return;
		}
		const edits = message.edits ?? [];
		push( 'model', [
			...( message.text ? [ { text: message.text } ] : [] ),
			...edits.map( ( edit ) => ( { functionCall: { name: EDIT_TOOL.name, args: edit } } ) ),
		] );
		push(
			'user',
			edits.map( ( _, number ) => ( {
				functionResponse: {
					name: EDIT_TOOL.name,
					response: { output: describeApplied( message.editRefs?.[ number ] ) },
				},
			} ) )
		);
	} );
	return result;
}

/**
 * Builds the body of a request to Gemini's `generateContent`.
 *
 * The relay sets the token limit of the answer, so the body leaves it out.
 *
 * The relay takes `model` out of the body and puts it in the address, as
 * Gemini wants it.
 *
 * @param system   The system prompt.
 * @param contents The contents.
 * @param model    The model that answers.
 * @return The request body.
 */
export function buildGeminiBody( system: string, contents: GeminiContent[], model = GEMINI_MODEL ) {
	return {
		model,
		systemInstruction: { parts: [ { text: system } ] },
		contents,
		tools: [ { functionDeclarations: [ GEMINI_EDIT_TOOL, ...GEMINI_READ_TOOLS ] } ],
		generationConfig: {
			// Summaries of the thoughts arrive, so the user sees that the model is thinking.
			thinkingConfig: {
				includeThoughts: true,
				...( model === GEMINI_MODEL && { thinkingLevel: GEMINI_THINKING_LEVEL } ),
			},
		},
	};
}

/**
 * Finds a readable message in an error response from the relay or from
 * Gemini, which may wrap its error in an array.
 *
 * @param response The error response.
 * @return The message.
 */
export async function readGeminiErrorMessage( response: Response ): Promise< string > {
	try {
		let body = await response.json();
		if ( Array.isArray( body ) ) {
			body = body[ 0 ];
		}
		// Gemini: `{ error: { message } }`. WordPress: `{ code, message }`.
		const message = body?.error?.message ?? body?.message;
		if ( typeof message === 'string' && message ) {
			return message;
		}
	} catch {
		// Not JSON, so fall through to the status.
	}
	return `${ response.status } ${ response.statusText }`.trim();
}

/**
 * The reasons Gemini stops an answer because of what it says.
 */
const DECLINED_REASONS = [
	'SAFETY',
	'RECITATION',
	'LANGUAGE',
	'BLOCKLIST',
	'PROHIBITED_CONTENT',
	'SPII',
	'IMAGE_SAFETY',
];

/**
 * What a request to Gemini answered.
 */
type GeminiAnswer = {
	/**
	 * The answer's parts, as they are sent back to the model.
	 */
	parts: GeminiPart[];
	/**
	 * The function calls among them.
	 */
	calls: GeminiPart[];
};

/**
 * Adds a streamed part to the answer. Text that follows text of the same
 * kind is joined to it, unless the earlier part ends with a signature.
 *
 * @param parts The answer's parts so far.
 * @param part  The new part.
 */
function addPart( parts: GeminiPart[], part: GeminiPart ) {
	const last = parts[ parts.length - 1 ];
	const isText = ( item: GeminiPart ) =>
		typeof item.text === 'string' &&
		Object.keys( item ).every( ( key ) =>
			[ 'text', 'thought', 'thoughtSignature' ].includes( key )
		);
	if (
		last &&
		isText( last ) &&
		isText( part ) &&
		! last.thoughtSignature &&
		Boolean( last.thought ) === Boolean( part.thought )
	) {
		last.text += part.text as string;
		if ( part.thoughtSignature ) {
			last.thoughtSignature = part.thoughtSignature;
		}
		return;
	}
	parts.push( { ...part } );
}

/**
 * Streams Gemini's answer through `onEvent`, and collects its parts.
 *
 * @param events  The events of the answer.
 * @param onEvent Called for each event of the answer.
 * @return The answer.
 */
export async function readGeminiStream(
	events: AsyncIterable< AnswerEvent >,
	onEvent: AiChatRequest[ 'onEvent' ]
): Promise< GeminiAnswer > {
	const declined = __( 'The model declined to answer.', 'blocktune' );
	const parts: GeminiPart[] = [];
	let usage: AiUsage | undefined;
	let finishReason: string | undefined;
	let thinking = false;

	for await ( const { data: payload } of events ) {
		if ( payload.error ) {
			throw new Error(
				payload.error.message ?? __( 'The answer could not be loaded.', 'blocktune' )
			);
		}
		if ( payload.promptFeedback?.blockReason ) {
			throw new Error( declined );
		}

		const used = payload.usageMetadata;
		if ( used ) {
			// Each chunk counts the whole answer so far, so the last one is kept.
			usage = {
				// Gemini counts cached tokens as part of `promptTokenCount`.
				inputTokens: used.promptTokenCount ?? 0,
				cachedInputTokens: used.cachedContentTokenCount ?? 0,
				outputTokens: ( used.candidatesTokenCount ?? 0 ) + ( used.thoughtsTokenCount ?? 0 ),
			};
		}

		const candidate = payload.candidates?.[ 0 ];
		for ( const part of ( candidate?.content?.parts ?? [] ) as GeminiPart[] ) {
			if ( part.thought ) {
				if ( ! thinking ) {
					thinking = true;
					onEvent( { type: 'activity', activity: 'thinking' } );
				}
			} else if ( part.functionCall ) {
				thinking = false;
				onEvent( { type: 'activity', activity: getToolActivity( part.functionCall.name ) } );
			} else if ( part.text ) {
				thinking = false;
				onEvent( { type: 'text', text: part.text } );
			}
			addPart( parts, part );
		}
		finishReason = candidate?.finishReason ?? finishReason;
	}

	if ( usage ) {
		onEvent( { type: 'usage', usage } );
	}

	// The last piece of the answer says why it ended, so without it, the
	// stream ended early.
	if ( ! finishReason ) {
		throw connectionLost();
	}
	if ( DECLINED_REASONS.includes( finishReason ) ) {
		throw new Error( declined );
	}
	// It can cut a function call off, so its edit is not applied.
	if ( finishReason === 'MAX_TOKENS' ) {
		throw new Error( __( 'The answer was cut off because it was too long.', 'blocktune' ) );
	}
	if ( finishReason === 'MALFORMED_FUNCTION_CALL' || finishReason === 'UNEXPECTED_TOOL_CALL' ) {
		throw new Error( __( 'The edit could not be made.', 'blocktune' ) );
	}

	return { parts, calls: parts.filter( ( part ) => part.functionCall ) };
}

/**
 * Connects the AI assistant to Google's Gemini through the plugin's relay,
 * which adds the site's API key on the server.
 *
 * @param getPostId Returns the ID of the post being edited.
 * @param model     The model that answers.
 * @return The connection.
 */
export function createGeminiPlatform( getPostId: () => number, model = GEMINI_MODEL ): AiPlatform {
	return {
		chat( { system, messages, onEvent, read, signal } ) {
			const contents = toGeminiContents( messages );
			return runToolLoop(
				{
					readAnswer: ( onAnswerEvent ) =>
						readGeminiStream(
							requestAnswer( {
								provider: 'google',
								postId: getPostId(),
								body: buildGeminiBody( system, contents, model ),
								signal,
								readError: readGeminiErrorMessage,
								// The whole answer has the shape of one piece of a streamed one.
								toEvents: ( whole ) => [ { event: 'message', data: whole } ],
							} ),
							onAnswerEvent
						),
					getCalls: ( answer ) =>
						answer.calls.length
							? answer.calls.map( ( { functionCall } ) => {
									const { id, name = '', args } = functionCall ?? {};
									return { id, name, input: args };
								} )
							: null,
					toResult: ( call, { text, failed } ): GeminiPart => ( {
						functionResponse: {
							...( call.id ? { id: call.id } : {} ),
							name: call.name ?? '',
							response: failed ? { error: text } : { output: text },
						},
					} ),
					// The answer goes back unchanged, with its thought signatures, so
					// the model goes on from where it stopped.
					append: ( answer, results ) => {
						contents.push(
							{ role: 'model', parts: answer.parts },
							{ role: 'user', parts: results }
						);
					},
				},
				{ onEvent, read }
			);
		},
	};
}

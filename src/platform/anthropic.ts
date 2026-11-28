/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import type { AiChatRequest, AiMessage, AiPlatform, AiUsage } from '.';
import { READ_TOOLS, getToolActivity } from './read-tools';
import { EDIT_TOOL, describeApplied, readErrorMessage, runToolLoop } from './tools';
import { connectionLost, requestAnswer, type AnswerEvent } from './transport';

/**
 * The model that answers when no other model is chosen.
 */
export const ANTHROPIC_MODEL = 'claude-sonnet-5-5';

/**
 * A content block of a message, as Anthropic's Messages API has it.
 */
type ContentBlock = { type: string; [ key: string ]: unknown };

type AnthropicMessage = { role: 'user' | 'assistant'; content: ContentBlock[] };

/**
 * Converts the conversation into Anthropic's messages.
 *
 * Earlier answers are sent as their text and edits, with the reference IDs
 * of the blocks the edits added. The model's thinking is not kept, and the
 * API accepts a history without it.
 *
 * @param messages The conversation.
 * @return The messages.
 */
export function toAnthropicMessages( messages: AiMessage[] ): AnthropicMessage[] {
	const result: AnthropicMessage[] = [];
	const push = ( role: AnthropicMessage[ 'role' ], content: ContentBlock[] ) => {
		const last = result[ result.length - 1 ];
		if ( last?.role === role ) {
			last.content.push( ...content );
		} else {
			result.push( { role, content } );
		}
	};
	messages.forEach( ( message, index ) => {
		if ( message.role === 'user' ) {
			push( 'user', [ { type: 'text', text: message.text } ] );
			return;
		}
		const edits = message.edits ?? [];
		const ids = edits.map( ( _, number ) => `toolu_edit_${ index }_${ number }` );
		push( 'assistant', [
			...( message.text ? [ { type: 'text', text: message.text } ] : [] ),
			...edits.map( ( edit, number ) => ( {
				type: 'tool_use',
				id: ids[ number ],
				name: EDIT_TOOL.name,
				input: edit,
			} ) ),
		] );
		if ( ids.length ) {
			push(
				'user',
				ids.map( ( id, number ) => ( {
					type: 'tool_result',
					tool_use_id: id,
					content: describeApplied( message.editRefs?.[ number ] ),
				} ) )
			);
		}
	} );
	return result;
}

/**
 * Marks where Anthropic caches the prompt up to, for five minutes.
 */
const CACHE_CONTROL = { type: 'ephemeral' } as const;

/**
 * Builds the body of a request to Anthropic's Messages API.
 *
 * The relay sets the token limit of the answer, so the body leaves it out.
 *
 * The prompt is cached at two points. The marker on the system prompt
 * caches the tool and the system prompt, which stay the same in every
 * request, so they are read from the cache even when the conversation
 * changes. The marker on the body caches the whole conversation, so the
 * next message or tool call only pays in full for what it adds.
 *
 * @param system   The system prompt.
 * @param messages The messages.
 * @param model    The model that answers.
 * @return The request body.
 */
export function buildAnthropicBody(
	system: string,
	messages: AnthropicMessage[],
	model = ANTHROPIC_MODEL
) {
	return {
		model,
		cache_control: CACHE_CONTROL,
		system: [ { type: 'text', text: system, cache_control: CACHE_CONTROL } ],
		tools: [ EDIT_TOOL, ...READ_TOOLS ],
		messages,
	};
}

/**
 * What a request to Anthropic answered.
 */
type AnthropicAnswer = {
	/**
	 * The answer's content blocks, as they are sent back to the model.
	 */
	content: ContentBlock[];
	stopReason: string | null;
	/**
	 * The input of each tool call whose input is not valid JSON, by the
	 * call's ID.
	 */
	invalidInputs: Map< string, string >;
};

/**
 * Streams Anthropic's answer through `onEvent`, and collects its content.
 *
 * @param events  The events of the answer.
 * @param onEvent Called for each event of the answer.
 * @return The answer.
 */
export async function readAnthropicStream(
	events: AsyncIterable< AnswerEvent >,
	onEvent: AiChatRequest[ 'onEvent' ]
): Promise< AnthropicAnswer > {
	let usage: AiUsage | undefined;
	let stopReason: string | null = null;
	const content: ContentBlock[] = [];
	const inputs: string[] = [];
	const invalidInputs = new Map< string, string >();

	for await ( const { event, data: payload } of events ) {
		if ( event === 'ping' ) {
			continue;
		}
		const block = content[ payload.index ];

		switch ( event ) {
			case 'message_start': {
				const start = payload.message?.usage ?? {};
				const cached = start.cache_read_input_tokens ?? 0;
				usage = {
					// Anthropic counts cached and newly cached tokens apart from `input_tokens`.
					inputTokens:
						( start.input_tokens ?? 0 ) + cached + ( start.cache_creation_input_tokens ?? 0 ),
					cachedInputTokens: cached,
					outputTokens: start.output_tokens ?? 0,
				};
				break;
			}
			case 'content_block_start': {
				const started = { ...payload.content_block };
				content[ payload.index ] = started;
				if ( started.type === 'thinking' || started.type === 'redacted_thinking' ) {
					onEvent( { type: 'activity', activity: 'thinking' } );
				} else if ( started.type === 'tool_use' ) {
					inputs[ payload.index ] = '';
					onEvent( { type: 'activity', activity: getToolActivity( started.name ) } );
				}
				break;
			}
			case 'content_block_delta': {
				const { delta } = payload;
				if ( delta?.type === 'text_delta' ) {
					if ( block ) {
						block.text = ( block.text ?? '' ) + delta.text;
					}
					onEvent( { type: 'text', text: delta.text } );
				} else if ( block && delta?.type === 'thinking_delta' ) {
					block.thinking = ( block.thinking ?? '' ) + delta.thinking;
				} else if ( block && delta?.type === 'signature_delta' ) {
					block.signature = delta.signature;
				} else if ( delta?.type === 'input_json_delta' ) {
					inputs[ payload.index ] = ( inputs[ payload.index ] ?? '' ) + delta.partial_json;
				}
				break;
			}
			case 'content_block_stop':
				if ( block?.type === 'tool_use' ) {
					const input = inputs[ payload.index ] ?? '';
					try {
						block.input = input ? JSON.parse( input ) : {};
					} catch {
						block.input = {};
						invalidInputs.set( block.id as string, input );
					}
				}
				break;
			case 'message_delta':
				stopReason = payload.delta?.stop_reason ?? stopReason;
				if ( usage && typeof payload.usage?.output_tokens === 'number' ) {
					usage.outputTokens = payload.usage.output_tokens;
				}
				break;
			case 'error':
				throw new Error(
					payload.error?.message ?? __( 'The answer could not be loaded.', 'blocktune' )
				);
		}
	}

	if ( usage ) {
		onEvent( { type: 'usage', usage } );
	}

	// The stream ended before the model said why it stopped.
	if ( stopReason === null ) {
		throw connectionLost();
	}
	// Either can cut a tool call off, so its edit is not applied.
	if ( stopReason === 'refusal' ) {
		throw new Error( __( 'The model declined to answer.', 'blocktune' ) );
	}
	if ( stopReason === 'max_tokens' ) {
		throw new Error( __( 'The answer was cut off because it was too long.', 'blocktune' ) );
	}

	return { content: content.filter( Boolean ), stopReason, invalidInputs };
}

/**
 * Turns Anthropic's whole answer, when it is not streamed, into the events
 * of a streamed one.
 *
 * @param answer The answer, a message.
 * @return The events.
 */
export function toAnthropicEvents( answer: any ): AnswerEvent[] {
	if ( ! Array.isArray( answer?.content ) ) {
		throw new Error( __( 'The answer could not be read.', 'blocktune' ) );
	}
	const event = ( name: string, data: object ): AnswerEvent => ( { event: name, data } );
	const events = [ event( 'message_start', { message: { usage: answer.usage ?? {} } } ) ];
	answer.content.forEach( ( block: ContentBlock, index: number ) => {
		if ( block.type === 'text' ) {
			events.push(
				event( 'content_block_start', { index, content_block: { ...block, text: '' } } ),
				event( 'content_block_delta', {
					index,
					delta: { type: 'text_delta', text: block.text ?? '' },
				} )
			);
		} else if ( block.type === 'thinking' ) {
			events.push(
				event( 'content_block_start', { index, content_block: { ...block, thinking: '' } } ),
				event( 'content_block_delta', {
					index,
					delta: { type: 'thinking_delta', thinking: block.thinking ?? '' },
				} )
			);
		} else if ( block.type === 'tool_use' ) {
			events.push(
				event( 'content_block_start', { index, content_block: { ...block, input: {} } } ),
				event( 'content_block_delta', {
					index,
					delta: { type: 'input_json_delta', partial_json: JSON.stringify( block.input ?? {} ) },
				} )
			);
		} else {
			events.push( event( 'content_block_start', { index, content_block: block } ) );
		}
		events.push( event( 'content_block_stop', { index } ) );
	} );
	events.push(
		event( 'message_delta', {
			delta: { stop_reason: answer.stop_reason ?? null },
			usage: { output_tokens: answer.usage?.output_tokens },
		} )
	);
	return events;
}

/**
 * What the model is told when its call of the edit tool does not match the
 * tool.
 */
const INVALID_EDIT = `Call ${ EDIT_TOOL.name } with "action" set to one of ${ EDIT_TOOL.input_schema.properties.action.enum.join( ', ' ) }, "markup" set to block markup, for "replace_block", "insert_before", and "delete_block", "ref" set to the reference ID of a block, and for "replace_text", "find" set to the text to replace.`;

/**
 * Connects the AI assistant to Anthropic through the plugin's relay, which
 * adds the site's API key on the server.
 *
 * @param getPostId Returns the ID of the post being edited.
 * @param model     The model that answers.
 * @return The connection.
 */
export function createAnthropicPlatform(
	getPostId: () => number,
	model = ANTHROPIC_MODEL
): AiPlatform {
	return {
		chat( { system, messages, onEvent, read, signal } ) {
			const conversation = toAnthropicMessages( messages );
			return runToolLoop(
				{
					readAnswer: ( onAnswerEvent ) =>
						readAnthropicStream(
							requestAnswer( {
								provider: 'anthropic',
								postId: getPostId(),
								body: buildAnthropicBody( system, conversation, model ),
								signal,
								readError: readErrorMessage,
								toEvents: toAnthropicEvents,
							} ),
							onAnswerEvent
						),
					getCalls: ( answer ) =>
						answer.stopReason === 'tool_use'
							? answer.content
									.filter( ( block ) => block.type === 'tool_use' )
									.map( ( block ) => {
										const invalid = answer.invalidInputs.get( block.id as string );
										return {
											id: block.id as string,
											name: block.name as string,
											input: invalid ?? block.input,
											invalid: invalid !== undefined,
										};
									} )
							: null,
					toResult: ( call, { text, failed } ) => ( {
						type: 'tool_result',
						tool_use_id: call.id,
						...( failed ? { is_error: true } : {} ),
						content: text,
					} ),
					// The answer goes back unchanged, with its thinking, so the model
					// goes on from where it stopped.
					append: ( answer, results ) => {
						conversation.push(
							{ role: 'assistant', content: answer.content },
							{ role: 'user', content: results }
						);
					},
					invalidEdit: INVALID_EDIT,
				},
				{ onEvent, read }
			);
		},
	};
}

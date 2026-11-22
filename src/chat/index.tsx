/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { arrowUp, blockDefault, typography } from '@wordpress/icons';
import { isKeyboardEvent } from '@wordpress/keycodes';
import { Icon, IconButton, Notice, Spinner, Stack, Text, TextareaControl } from '@wordpress/ui';

/**
 * Internal dependencies
 */
import {
	CONVERSATION_TOKEN_LIMIT,
	getConversationTokens,
	type AssistantChatMessage,
} from '../ai/conversation';
import type { AiChat } from '../ai/use-ai-chat';
import { getTextSelection } from '../editor/text-target';
import type { AiUsage } from '../platform';
import { AnswerMarkdown } from './answer-markdown';
import './style.scss';

function getActivityLabel( activity: NonNullable< AssistantChatMessage[ 'activity' ] > ) {
	switch ( activity ) {
		case 'thinking':
			return __( 'Thinking…', 'ai-chat-block-editor-extension' );
		case 'editing':
			return __( 'Editing the content…', 'ai-chat-block-editor-extension' );
		case 'reading':
			return __( 'Reading the content…', 'ai-chat-block-editor-extension' );
		default:
			return __( 'Waiting for the answer…', 'ai-chat-block-editor-extension' );
	}
}

/**
 * Describes the tokens an answer used, for example "12,345 input tokens
 * (10,000 cached), 678 output tokens".
 *
 * @param usage The tokens the answer used.
 */
export function formatUsage( usage: AiUsage ) {
	const input = sprintf(
		/* translators: %s: Number of tokens. */
		_n( '%s input token', '%s input tokens', usage.inputTokens, 'ai-chat-block-editor-extension' ),
		usage.inputTokens.toLocaleString()
	);
	const cached = usage.cachedInputTokens
		? sprintf(
				/* translators: %s: Number of tokens. */
				__( '(%s cached)', 'ai-chat-block-editor-extension' ),
				usage.cachedInputTokens.toLocaleString()
			)
		: '';
	const output = sprintf(
		/* translators: %s: Number of tokens. */
		_n(
			'%s output token',
			'%s output tokens',
			usage.outputTokens,
			'ai-chat-block-editor-extension'
		),
		usage.outputTokens.toLocaleString()
	);

	return cached
		? sprintf(
				/* translators: 1: Input tokens. 2: Cached input tokens. 3: Output tokens. Example: "12,345 input tokens (10,000 cached), 678 output tokens". */
				__( '%1$s %2$s, %3$s', 'ai-chat-block-editor-extension' ),
				input,
				cached,
				output
			)
		: sprintf(
				/* translators: 1: Input tokens. 2: Output tokens. Example: "12,345 input tokens, 678 output tokens". */
				__( '%1$s, %2$s', 'ai-chat-block-editor-extension' ),
				input,
				output
			);
}

function AssistantMessage( { message }: { message: AssistantChatMessage } ) {
	const activity = message.status === 'streaming' ? message.activity : undefined;

	return (
		<Stack
			className="ai-chat-block-editor-extension-chat__message is-assistant"
			direction="column"
			gap="sm"
		>
			{ message.text && <AnswerMarkdown>{ message.text }</AnswerMarkdown> }
			{ message.editStatus === 'applied' && (
				<Text variant="body-sm" className="ai-chat-block-editor-extension-chat__note">
					{ __( 'Edited the content.', 'ai-chat-block-editor-extension' ) }
				</Text>
			) }
			{ message.editStatus === 'dropped' && (
				<Text variant="body-sm" className="ai-chat-block-editor-extension-chat__note">
					{ __(
						'The edit was not applied because the selected blocks no longer exist.',
						'ai-chat-block-editor-extension'
					) }
				</Text>
			) }
			{ activity && (
				<Stack
					className="ai-chat-block-editor-extension-chat__note"
					direction="row"
					align="center"
					gap="sm"
					role="status"
				>
					<Spinner aria-hidden />
					<Text variant="body-sm">{ getActivityLabel( activity ) }</Text>
				</Stack>
			) }
			{ message.status === 'stopped' && (
				<Text variant="body-sm" className="ai-chat-block-editor-extension-chat__note">
					{ __( 'Stopped.', 'ai-chat-block-editor-extension' ) }
				</Text>
			) }
			{ message.status === 'error' && (
				<Notice.Root intent="error">
					<Notice.Description>
						{ message.error ||
							__( 'The answer could not be loaded.', 'ai-chat-block-editor-extension' ) }
					</Notice.Description>
				</Notice.Root>
			) }
			{ message.usage && message.status !== 'streaming' && (
				<Text variant="body-sm" className="ai-chat-block-editor-extension-chat__usage">
					{ formatUsage( message.usage ) }
				</Text>
			) }
		</Stack>
	);
}

/**
 * Describes what is selected in the editor now, which is sent with the
 * next message: "Text selected" or "3 blocks selected" with an icon, or
 * nothing.
 */
function useSelectionStatus() {
	return useSelect( ( select ) => {
		const editor = select( blockEditorStore );
		if ( getTextSelection( editor ) ) {
			return {
				icon: typography,
				label: __( 'Text selected', 'ai-chat-block-editor-extension' ),
			};
		}
		const count = editor.getSelectedBlockClientIds().length;
		if ( ! count ) {
			return null;
		}
		return {
			icon: blockDefault,
			label: sprintf(
				/* translators: %d: Number of selected blocks. */
				_n( '%d block selected', '%d blocks selected', count, 'ai-chat-block-editor-extension' ),
				count
			),
		};
	}, [] );
}

type Props = {
	chat: AiChat;
	/**
	 * Whether the user can send messages. The assistant edits blocks, so it
	 * is not available in the code editor.
	 */
	isAvailable: boolean;
	/**
	 * The message the user is writing. It is kept by the parent, so it
	 * survives while the chat is not shown.
	 */
	draft: string;
	onDraftChange: ( draft: string ) => void;
};

export function Chat( { chat, isAvailable, draft, onDraftChange: setDraft }: Props ) {
	const { conversation, isResponding, send, stop, reset } = chat;
	const messagesRef = useRef< HTMLDivElement >( null );
	const selection = useSelectionStatus();

	// Keep the latest message in view while the answer streams in.
	useEffect( () => {
		const element = messagesRef.current;
		if ( element ) {
			element.scrollTop = element.scrollHeight;
		}
	}, [ conversation ] );

	const isLong =
		! isResponding && getConversationTokens( conversation.messages ) > CONVERSATION_TOKEN_LIMIT;

	const canSend = isAvailable && !! draft.trim() && ! isResponding;

	const submit = () => {
		if ( canSend ) {
			send( draft );
			setDraft( '' );
		}
	};

	// Enter sends, and Shift+Enter adds a line.
	const onKeyDown = ( event: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		// Keys that control an IME conversion are left to the IME. Some
		// browsers, such as Safari, report them with key code 229 only.
		if ( event.nativeEvent.isComposing || event.keyCode === 229 ) {
			return;
		}
		// Undo and redo act on the draft, not on the post.
		if (
			isKeyboardEvent.primary( event.nativeEvent, 'z' ) ||
			isKeyboardEvent.primaryShift( event.nativeEvent, 'z' ) ||
			isKeyboardEvent.primary( event.nativeEvent, 'y' )
		) {
			event.stopPropagation();
			return;
		}
		if ( event.key === 'Enter' && ! event.shiftKey ) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<Stack className="ai-chat-block-editor-extension-chat" direction="column">
			<Stack
				className="ai-chat-block-editor-extension-chat__messages"
				direction="column"
				gap="lg"
				ref={ messagesRef }
			>
				{ ! isAvailable && (
					<Notice.Root intent="info">
						<Notice.Description>
							{ __(
								'Switch to the visual editor to use the AI chat.',
								'ai-chat-block-editor-extension'
							) }
						</Notice.Description>
					</Notice.Root>
				) }
				{ isAvailable && conversation.messages.length === 0 && (
					<Text variant="body-sm" className="ai-chat-block-editor-extension-chat__note">
						{ __(
							'Ask the AI to write or edit. The selected blocks are sent with your message.',
							'ai-chat-block-editor-extension'
						) }
					</Text>
				) }
				{ conversation.messages.map( ( message ) =>
					message.role === 'assistant' ? (
						<AssistantMessage key={ message.id } message={ message } />
					) : (
						<Text
							key={ message.id }
							className="ai-chat-block-editor-extension-chat__message is-user"
							render={ <div /> }
						>
							{ message.text }
						</Text>
					)
				) }
				{ isLong && (
					<Notice.Root intent="warning">
						<Notice.Description>
							{ __(
								'This conversation has grown long, so each message costs more. Start a new conversation to keep the cost down.',
								'ai-chat-block-editor-extension'
							) }
						</Notice.Description>
						<Notice.Actions>
							<Notice.ActionButton onClick={ reset }>
								{ __( 'New conversation', 'ai-chat-block-editor-extension' ) }
							</Notice.ActionButton>
						</Notice.Actions>
					</Notice.Root>
				) }
			</Stack>
			<Stack
				render={
					<form
						onSubmit={ ( event ) => {
							event.preventDefault();
							submit();
						} }
					/>
				}
				className="ai-chat-block-editor-extension-chat__composer"
				direction="column"
				gap="sm"
			>
				<TextareaControl
					className="ai-chat-block-editor-extension-chat__input"
					label={ __( 'Message', 'ai-chat-block-editor-extension' ) }
					hideLabelFromVision
					placeholder={ __( 'Ask the AI', 'ai-chat-block-editor-extension' ) }
					value={ draft }
					onValueChange={ setDraft }
					onKeyDown={ onKeyDown }
					disabled={ ! isAvailable }
				/>
				<Stack direction="row" align="center" justify="space-between" gap="sm">
					<Stack
						className="ai-chat-block-editor-extension-chat__selection"
						direction="row"
						align="center"
						gap="xs"
						aria-live="polite"
					>
						{ isAvailable && selection && (
							<>
								<Icon icon={ selection.icon } />
								<Text variant="body-sm">{ selection.label }</Text>
							</>
						) }
					</Stack>
					{ isResponding ? (
						<IconButton
							icon={
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
									<path d="M7 7h10v10H7z" fill="currentColor" />
								</svg>
							}
							label={ __( 'Stop', 'ai-chat-block-editor-extension' ) }
							tone="neutral"
							size="compact"
							onClick={ stop }
						/>
					) : (
						<IconButton
							type="submit"
							icon={ arrowUp }
							label={ __( 'Send', 'ai-chat-block-editor-extension' ) }
							size="compact"
							disabled={ ! canSend }
						/>
					) }
				</Stack>
			</Stack>
		</Stack>
	);
}

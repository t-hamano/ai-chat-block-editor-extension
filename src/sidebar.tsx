/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { select as selectStore, useSelect } from '@wordpress/data';
import { PluginSidebar, PluginSidebarMoreMenuItem, store as editorStore } from '@wordpress/editor';
import { createInterpolateElement, useCallback, useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { cog, plus } from '@wordpress/icons';
import { store as preferencesStore } from '@wordpress/preferences';
import { IconButton, Notice } from '@wordpress/ui';

/**
 * Internal dependencies
 */
import { useAiChat } from './ai/use-ai-chat';
import { Chat } from './chat';
import { createSelectionTarget } from './editor/text-target';
import icon from './icon';
import { createAutoPlatform, type ModelChoice } from './platform/select';
import { ModelSettings } from './settings';

const SIDEBAR_NAME = 'ai-chat';

const ai = createAutoPlatform(
	() =>
		( selectStore( preferencesStore ).get( 'blocktune', 'model' ) as ModelChoice | null ) ?? null
);

const { isAiSupported, hasApiKey, connectorsUrl } = window.blocktune;

// The assistant can be used only when the site allows AI and has an API key.
const isUsable = isAiSupported && hasApiKey;

// The site can turn AI off, and then every request is refused, so the
// sidebar says so instead of showing the chat.
function AiNotSupportedNotice() {
	return (
		<div className="blocktune-sidebar__notice">
			<Notice.Root intent="info">
				<Notice.Description>
					{ __( 'AI features are turned off on this site.', 'blocktune' ) }
				</Notice.Description>
			</Notice.Root>
		</div>
	);
}

// Without an API key the assistant cannot be used, so the sidebar links to
// the Connectors screen, where one is set up.
function NoConnectorNotice() {
	return (
		<div className="blocktune-sidebar__notice">
			<Notice.Root intent="info">
				<Notice.Description>
					{ createInterpolateElement(
						__(
							'No connector is set up. Set up at least one connector on the <a>Connectors screen</a>.',
							'blocktune'
						),
						// eslint-disable-next-line jsx-a11y/anchor-has-content -- The link text is filled in from the translation.
						{ a: <a href={ connectorsUrl } /> }
					) }
				</Notice.Description>
			</Notice.Root>
		</div>
	);
}

export default function Sidebar() {
	const title = __( 'Blocktune', 'blocktune' );
	const [ isSettingsOpen, setIsSettingsOpen ] = useState( false );
	const [ draft, setDraft ] = useState( '' );
	const { isVisualEditor, documentRoot } = useSelect( ( select ) => {
		const { getEditorMode, getRenderingMode } = select( editorStore );
		return {
			isVisualEditor: getEditorMode() === 'visual',
			// The block that holds the document the AI edits. When the
			// template is shown around the post, the post is inside the Post
			// Content block, as the editor also finds it.
			documentRoot:
				getRenderingMode() === 'template-locked'
					? select( blockEditorStore ).getBlocksByName( 'core/post-content' )[ 0 ]
					: undefined,
		};
	}, [] );
	const createTarget = useCallback( () => createSelectionTarget( documentRoot ), [ documentRoot ] );
	const chat = useAiChat( { ai, createTarget } );
	const { stop, reset } = chat;

	// The conversation is about the blocks, so it ends when the user
	// switches to the code editor.
	useEffect( () => {
		if ( ! isVisualEditor ) {
			stop();
			reset();
		}
	}, [ isVisualEditor, stop, reset ] );

	return (
		<>
			<PluginSidebarMoreMenuItem target={ SIDEBAR_NAME } icon={ icon }>
				{ title }
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				name={ SIDEBAR_NAME }
				title={ title }
				icon={ icon }
				className="blocktune-sidebar"
				// @ts-expect-error `PluginSidebar` passes `render` and `header` on to `ComplementaryArea`, but its types leave them out.
				render={ <div className="blocktune-sidebar-area" /> }
				header={
					<>
						<h2 className="interface-complementary-area-header__title">{ title }</h2>
						<IconButton
							icon={ plus }
							label={ __( 'New conversation', 'blocktune' ) }
							variant="minimal"
							tone="neutral"
							size="compact"
							onClick={ reset }
							disabled={ chat.conversation.messages.length === 0 }
						/>
						<IconButton
							icon={ cog }
							label={ __( 'Chat settings', 'blocktune' ) }
							variant="minimal"
							tone="neutral"
							size="compact"
							aria-pressed={ isSettingsOpen }
							onClick={ () => setIsSettingsOpen( ! isSettingsOpen ) }
							disabled={ ! isUsable }
						/>
					</>
				}
			>
				{ isSettingsOpen && <ModelSettings onClose={ () => setIsSettingsOpen( false ) } /> }
				{ ! isSettingsOpen && ! isAiSupported && <AiNotSupportedNotice /> }
				{ ! isSettingsOpen && isAiSupported && ! hasApiKey && <NoConnectorNotice /> }
				{ ! isSettingsOpen && isUsable && (
					<Chat
						chat={ chat }
						isAvailable={ isVisualEditor }
						documentRoot={ documentRoot }
						draft={ draft }
						onDraftChange={ setDraft }
					/>
				) }
			</PluginSidebar>
		</>
	);
}

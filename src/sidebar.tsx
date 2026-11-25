/**
 * WordPress dependencies
 */
import { select as selectStore, useSelect } from '@wordpress/data';
import { PluginSidebar, PluginSidebarMoreMenuItem, store as editorStore } from '@wordpress/editor';
import { createInterpolateElement, useEffect, useState } from '@wordpress/element';
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
	() => selectStore( editorStore ).getCurrentPostId() as number,
	() =>
		( selectStore( preferencesStore ).get( 'blocktune', 'model' ) as ModelChoice | null ) ?? null
);

const { hasApiKey, connectorsUrl } = window.blocktune;

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
	const title = __( 'AI Chat', 'blocktune' );
	const isVisualEditor = useSelect(
		( select ) => select( editorStore ).getEditorMode() === 'visual',
		[]
	);
	const chat = useAiChat( { ai, createTarget: createSelectionTarget } );
	const { stop, reset } = chat;
	const [ isSettingsOpen, setIsSettingsOpen ] = useState( false );
	const [ draft, setDraft ] = useState( '' );

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
				// @ts-expect-error `PluginSidebar` passes `header` on to `ComplementaryArea`, but its types leave it out.
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
						/>
					</>
				}
			>
				{ isSettingsOpen && <ModelSettings onClose={ () => setIsSettingsOpen( false ) } /> }
				{ ! isSettingsOpen && ! hasApiKey && <NoConnectorNotice /> }
				{ ! isSettingsOpen && hasApiKey && (
					<Chat
						chat={ chat }
						isAvailable={ isVisualEditor }
						draft={ draft }
						onDraftChange={ setDraft }
					/>
				) }
			</PluginSidebar>
		</>
	);
}

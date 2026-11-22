/**
 * External dependencies
 */
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * WordPress dependencies
 */
import { Link, Text } from '@wordpress/ui';

const remarkPlugins = [ remarkGfm ];

const components: Components = {
	a: ( { href, children } ) =>
		href ? (
			<Link href={ href } openInNewTab>
				{ children }
			</Link>
		) : (
			<>{ children }</>
		),
	// An answer could point an image at any URL, which would load as soon as
	// it shows. Only the alt text is shown.
	img: ( { alt } ) => <>{ alt }</>,
};

/**
 * Shows the text of an answer with its Markdown formatting, such as bold
 * text, lists, and code.
 *
 * The Markdown becomes React elements, never HTML strings. HTML written in
 * the answer is not rendered, and links with unsafe URLs, such as
 * `javascript:`, lose their URL.
 *
 * @param props          Component props.
 * @param props.children The Markdown text of the answer.
 */
export function AnswerMarkdown( { children }: { children: string } ) {
	return (
		<Text className="ai-chat-block-editor-extension-chat__markdown" render={ <div /> }>
			<Markdown remarkPlugins={ remarkPlugins } components={ components }>
				{ children }
			</Markdown>
		</Text>
	);
}

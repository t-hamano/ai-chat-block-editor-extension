/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import { registerCoreBlocks } from '@wordpress/block-library';
import {
	getBlockType,
	getBlockTypes,
	parse,
	registerBlockStyle,
	serialize,
	store as blocksStore,
	type Block,
} from '@wordpress/blocks';
import { dispatch, select } from '@wordpress/data';
import { create } from '@wordpress/rich-text';

/**
 * Internal dependencies
 */
import {
	conversationReducer,
	createConversation,
	getLastSeenDocument,
	toAiMessages,
	toUserText,
	type Conversation,
} from '../../src/ai/conversation';
import { buildMessageContext } from '../../src/ai/document-context';
import { readDocument } from '../../src/ai/document-outline';
import { buildSystemPrompt } from '../../src/ai/prompt';
import { createAnthropicPlatform } from '../../src/platform/anthropic';
import { collectHtml, validateMarkup } from '../../src/editor/validate-markup';
import { getSiteInfo } from '../../src/editor/site-info';
import { createSelectionTarget } from '../../src/editor/text-target';
import type { AiEditResult } from '../../src/platform';
import { setUpRelay } from './relay';
import type { Usage } from './usage';
import theme from './theme.json';

/**
 * The model every case runs with, so results can be compared.
 */
export const MODEL = 'claude-sonnet-5-5';

/**
 * Where a block is: its index at the top level, then in its parent's inner
 * blocks, and so on.
 */
type BlockPath = number[];

/**
 * One case, from the variables of a test in `promptfooconfig.yaml`.
 */
export type EvalCase = {
	/**
	 * What the user writes first.
	 */
	request: string;
	/**
	 * What the user writes after the first answer, for a second turn.
	 */
	followUp?: string;
	/**
	 * The document, as block markup.
	 */
	document: string;
	/**
	 * What is selected when the first message is sent. Without it, nothing
	 * is. With `to`, the blocks from `block` to `to`, which share a parent.
	 * With `text`, the first place of that text in the block's content. Later messages are sent with nothing selected.
	 */
	select?: { block: BlockPath; to?: BlockPath; text?: string };
};

/**
 * What became of one message of the conversation.
 */
export type TurnResult = {
	request: string;
	applied: number;
	/**
	 * Edits the editor sent back to the model to fix: the action and the
	 * reference ID, why, and the markup.
	 */
	failures: string[];
	dropped: number;
	text: string;
	/**
	 * What each request of the answer did, in order: `text` when the
	 * model wrote text, the tools it called, what became of its edits
	 * (`applied`, `fixed`, `failed`, or `dropped`), and `discarded` when
	 * its text was taken back.
	 */
	requests: string[][];
	error?: string;
};

/**
 * What one case produced, which the assertions check.
 */
export type CaseResult = {
	model: string;
	turns: TurnResult[];
	/**
	 * The document after the last answer, as block markup without
	 * reference IDs.
	 */
	document: string;
	/**
	 * The names of the blocks in it, nested blocks included.
	 */
	blockNames: string[];
	/**
	 * What is wrong with the document's markup. Empty when the editor reads
	 * every block as valid.
	 */
	problems: string[];
	/**
	 * The failed tool calls the model tried again, edits and reads.
	 */
	retries: number;
	/**
	 * The error responses of Anthropic, which make the case an error
	 * rather than a failure.
	 */
	requestErrors: string[];
	usage: Usage;
	seconds: number;
};

let siteReady = false;

/**
 * The places of presets in `theme.json` settings. The editor keeps each
 * preset list by where it comes from, here the theme.
 */
const PRESETS = [
	[ 'color', 'palette' ],
	[ 'color', 'gradients' ],
	[ 'color', 'duotone' ],
	[ 'shadow', 'presets' ],
	[ 'spacing', 'spacingSizes' ],
	[ 'typography', 'fontSizes' ],
	[ 'typography', 'fontFamilies' ],
];

/**
 * Turns the settings of `theme.json` into the settings the editor has.
 *
 * @param settings The settings.
 * @return The editor's settings.
 */
function toEditorSettings( settings: Record< string, any > ): Record< string, any > {
	const result = structuredClone( settings );
	for ( const [ section, preset ] of PRESETS ) {
		if ( result[ section ]?.[ preset ] ) {
			result[ section ][ preset ] = { theme: result[ section ][ preset ] };
		}
	}
	return result;
}

/**
 * Registers the core blocks, the theme settings, and the block style
 * variations of the theme's styles, as WordPress registers them, once.
 */
function setUpSite() {
	if ( siteReady || getBlockTypes().length ) {
		siteReady = true;
		return;
	}
	// The block library complains about editor parts that need a browser,
	// which the evaluation does not use.
	/* eslint-disable no-console */
	const { warn, error } = console;
	console.warn = () => {};
	console.error = () => {};
	registerCoreBlocks();
	console.warn = warn;
	console.error = error;
	/* eslint-enable no-console */
	dispatch( blockEditorStore ).updateSettings( {
		__experimentalFeatures: toEditorSettings( theme.settings ),
	} );
	const blocks: Record< string, { variations?: object } > = theme.styles.blocks;
	for ( const [ name, { variations = {} } ] of Object.entries( blocks ) ) {
		const registered = ( select( blocksStore ).getBlockStyles( name ) ?? [] ).map(
			( style: { name: string } ) => style.name
		);
		for ( const variation of Object.keys( variations ) ) {
			if ( ! registered.includes( variation ) ) {
				registerBlockStyle( name, {
					name: variation,
					label: variation.replace( /-/g, ' ' ).replace( /^\w/, ( c ) => c.toUpperCase() ),
				} );
			}
		}
	}
	siteReady = true;
}

/**
 * Gives every block that holds other blocks the settings the editor gives
 * it when it shows the block. Without them, the editor allows no block
 * inside it, since nothing is shown here.
 */
function setUpInnerBlocks() {
	const { getBlock, getBlockListSettings, getClientIdsWithDescendants } =
		select( blockEditorStore );
	const { updateBlockListSettings } = dispatch( blockEditorStore );
	for ( const clientId of getClientIdsWithDescendants() ) {
		const block = getBlock( clientId );
		const holdsBlocks =
			block?.innerBlocks.length || getBlockType( block?.name ?? '' )?.allowedBlocks;
		if ( holdsBlocks && ! getBlockListSettings( clientId ) ) {
			updateBlockListSettings( clientId, {} );
		}
	}
}

function findBlock( blocks: Block[], path: BlockPath ): Block {
	const block = path.reduce< Block | undefined >(
		( parent, index, depth ) => ( depth ? parent?.innerBlocks : blocks )?.[ index ],
		undefined
	);
	if ( ! block ) {
		throw new Error( `There is no block at [${ path.join( ', ' ) }].` );
	}
	return block;
}

/**
 * Lists what the editor would not read in a document: invalid blocks and
 * HTML outside of blocks.
 *
 * @param document The document.
 * @return The problems.
 */
export function findDocumentProblems( document: string ): string[] {
	const check = ( blocks: Block[] ): string[] =>
		blocks.flatMap( ( block ) => [
			...( block.isValid ? [] : [ `${ block.name } is not valid` ] ),
			...( block.name === 'core/freeform' ? [ 'HTML outside of blocks' ] : [] ),
			...check( block.innerBlocks ),
		] );
	return check( parse( document ) );
}

/**
 * Loads the case's document and selection in the editor.
 *
 * @param evalCase The case.
 * @return The parsed blocks.
 */
function loadCase( evalCase: EvalCase ): Block[] {
	const problems = findDocumentProblems( evalCase.document );
	if ( problems.length ) {
		throw new Error( `The case's document is not valid: ${ problems.join( ', ' ) }.` );
	}
	const blocks = parse( evalCase.document );
	const actions = dispatch( blockEditorStore );
	actions.resetBlocks( blocks );
	actions.clearSelectedBlock();

	const selection = evalCase.select;
	if ( selection?.text !== undefined ) {
		const block = findBlock( blocks, selection.block );
		const { text } = create( { html: String( block.attributes.content ?? '' ) } );
		const start = text.indexOf( selection.text );
		if ( start < 0 ) {
			throw new Error( `"${ selection.text }" is not in the content of the block.` );
		}
		actions.selectionChange( block.clientId, 'content', start, start + selection.text.length );
	} else if ( selection?.to ) {
		actions.multiSelect(
			findBlock( blocks, selection.block ).clientId,
			findBlock( blocks, selection.to ).clientId
		);
	} else if ( selection ) {
		actions.selectBlock( findBlock( blocks, selection.block ).clientId );
	}
	return blocks;
}

/**
 * Sends one message the way the sidebar does (`useAiChat()`): the
 * selection is captured, the message carries the document or its changes
 * since the last answer, and the model's edits are applied as they arrive.
 *
 * @param conversation The conversation so far.
 * @param request      What the user writes.
 * @param chat         Sends the request to the model.
 * @return The conversation with the answer, and what became of it.
 */
async function sendMessage(
	conversation: Conversation,
	request: string,
	chat: ReturnType< typeof createAnthropicPlatform >[ 'chat' ]
): Promise< { conversation: Conversation; turn: TurnResult } > {
	const target = createSelectionTarget();
	const context = target.getContext();
	const messageContext = buildMessageContext(
		context,
		getLastSeenDocument( conversation.messages )
	);
	const messages = [
		...toAiMessages( conversation.messages ),
		{ role: 'user' as const, text: toUserText( request, messageContext ) },
	];
	const turn: TurnResult = {
		request,
		applied: 0,
		failures: [],
		dropped: 0,
		text: '',
		requests: [],
	};
	// The usage ends each request. The edits and the text taken back come
	// after it, so they belong to the request that ended last.
	let steps: string[] = [];
	const note = ( step: string ) => {
		if ( steps.at( -1 ) !== step ) {
			steps.push( step );
		}
	};
	let current = conversationReducer( conversation, {
		type: 'START',
		text: request,
		context: messageContext,
		document: context.document,
	} );
	let seenDocument: string | undefined = context.document;

	try {
		await chat( {
			system: buildSystemPrompt( context.document, getSiteInfo() ),
			messages,
			signal: new AbortController().signal,
			read: ( read ) => readDocument( target.getDocument(), read ),
			onEvent( event ) {
				if ( event.type === 'usage' ) {
					turn.requests.push( steps );
					steps = [];
					return;
				}
				if ( event.type === 'activity' ) {
					if ( event.activity !== 'thinking' ) {
						note( event.activity );
					}
					return;
				}
				if ( event.type === 'text' ) {
					note( 'text' );
					turn.text += event.text;
					current = conversationReducer( current, { type: 'APPEND_TEXT', text: event.text } );
					return;
				}
				if ( event.type === 'discard_text' ) {
					turn.requests.at( -1 )?.push( 'discarded' );
					turn.text = turn.text.slice( 0, turn.text.length - event.text.length );
					current = conversationReducer( current, { type: 'DISCARD_TEXT', text: event.text } );
					return;
				}
				if ( event.type !== 'edit' ) {
					return;
				}
				setUpInnerBlocks();
				const result: AiEditResult = target.apply( event.edit );
				turn.requests
					.at( -1 )
					?.push( result.status === 'applied' && result.autoFix ? 'fixed' : result.status );
				if ( result.status === 'failed' ) {
					// Which edit failed, with its markup, to tell why the model sent it.
					const { action, markup } = event.edit;
					const ref = 'ref' in event.edit && event.edit.ref ? ` "${ event.edit.ref }"` : '';
					turn.failures.push( `${ action }${ ref }: ${ result.reason }\n${ markup }` );
					return result;
				}
				if ( result.status === 'applied' ) {
					turn.applied++;
					seenDocument = target.getDocument();
				} else {
					turn.dropped++;
				}
				current = conversationReducer( current, {
					type: 'EDIT',
					edit: event.edit,
					applied: result.status === 'applied',
				} );
				return result;
			},
		} );
		current = conversationReducer( current, {
			type: 'FINISH',
			status: 'done',
			documentAfter: seenDocument,
		} );
	} catch ( error ) {
		turn.error = error instanceof Error ? error.message : String( error );
		current = conversationReducer( current, {
			type: 'FINISH',
			status: 'error',
			error: turn.error,
		} );
	}
	return { conversation: current, turn };
}

/**
 * Runs a case: loads its document and selection, sends its messages to the
 * model through the plugin's own prompt, context, and Anthropic adapter,
 * and reports the document afterwards with what the model used.
 *
 * @param evalCase       The case.
 * @param options        Options.
 * @param options.apiKey The Anthropic API key.
 * @param options.model  The model, `MODEL` by default.
 * @return The result.
 */
export async function runCase(
	evalCase: EvalCase,
	{ apiKey, model = MODEL }: { apiKey: string; model?: string }
): Promise< CaseResult > {
	setUpSite();
	const blocks = loadCase( evalCase );
	const existingHtml = collectHtml( blocks );
	const relay = setUpRelay( apiKey );
	const platform = createAnthropicPlatform( model );

	const started = Date.now();
	let conversation = createConversation();
	const turns: TurnResult[] = [];
	for ( const request of [ evalCase.request, evalCase.followUp ] ) {
		if ( ! request ) {
			continue;
		}
		if ( turns.length ) {
			dispatch( blockEditorStore ).clearSelectedBlock();
		}
		const sent = await sendMessage( conversation, request, platform.chat );
		conversation = sent.conversation;
		turns.push( sent.turn );
		if ( sent.turn.error ) {
			break;
		}
	}
	await relay.settle();

	const after = select( blockEditorStore ).getBlocks();
	const document = serialize( after );
	const collect = ( list: Block[] ): string[] =>
		list.flatMap( ( block ) => [ block.name, ...collect( block.innerBlocks ) ] );
	return {
		model,
		turns,
		document,
		blockNames: [ ...new Set( collect( after ) ) ],
		problems: [
			...new Set( [
				...findDocumentProblems( document ),
				...validateMarkup( document, existingHtml ).problems,
			] ),
		],
		retries: relay.retries,
		requestErrors: relay.errors,
		usage: relay.usage,
		seconds: ( Date.now() - started ) / 1000,
	};
}

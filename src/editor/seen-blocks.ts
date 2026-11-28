/**
 * External dependencies
 */
import isEqual from 'fast-deep-equal';

/**
 * WordPress dependencies
 */
import { store as blockEditorStore } from '@wordpress/block-editor';
import type { Block } from '@wordpress/blocks';
import { select } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { LONG_DOCUMENT } from '../ai/document-outline';
import type { AiEditResult } from '../platform';
import { getClientIdByRef, serializeWithRefs } from './block-refs';
import { withoutControlledContent } from './document-root';

/**
 * A block without its inner blocks: what the user can change in the block
 * itself, and which blocks it holds.
 */
type BlockState = {
	name: string;
	attributes: Block[ 'attributes' ];
	innerIds: string[];
};

function toState( block: Block ): BlockState {
	return {
		name: block.name,
		attributes: block.attributes,
		innerIds: block.innerBlocks.map( ( { clientId } ) => clientId ),
	};
}

function collect( blocks: Block[], states = new Map< string, BlockState >() ) {
	for ( const block of blocks ) {
		states.set( block.clientId, toState( block ) );
		collect( block.innerBlocks, states );
	}
	return states;
}

/**
 * The blocks as the model last saw them, so that an edit does not undo what
 * the user changed while the answer streams.
 */
export type SeenBlocks = {
	/**
	 * Keeps the blocks the model read, and their inner blocks when it read
	 * them too.
	 *
	 * @param refs The reference IDs of the blocks.
	 */
	markRead: ( refs: string[] ) => void;
	/**
	 * Finds a block among the blocks and their inner blocks that changed
	 * since the model last saw it.
	 *
	 * @param clientIds The client IDs of the blocks.
	 * @return The client ID of the changed block, or `undefined`.
	 */
	findChanged: ( clientIds: string[] ) => string | undefined;
	/**
	 * Applies the model's edit, and keeps the blocks it changed as the
	 * model now knows them. Blocks the user also changed are left as
	 * changed.
	 *
	 * @param apply Applies the edit.
	 * @return What became of the edit.
	 */
	track: ( apply: () => AiEditResult ) => AiEditResult;
};

/**
 * Keeps the blocks in the document now as the model saw them.
 *
 * @param root The block that holds the document, if any.
 * @return The blocks as the model saw them.
 */
export function createSeenBlocks( root?: string ): SeenBlocks {
	const editor = () => select( blockEditorStore );
	// The blocks in the document now, without the content of the blocks that
	// keep it elsewhere, which the model never sees.
	const getBlocks = () => withoutControlledContent( editor().getBlocks( root ) );
	const seen = collect( getBlocks() );
	const isSeen = ( clientId: string, state: BlockState | undefined ) => {
		const known = seen.get( clientId );
		return !! known && !! state && isEqual( known, state );
	};

	/**
	 * Keeps the blocks the model's edit added or changed, unless the user
	 * had changed them too, and forgets the blocks it removed.
	 *
	 * @param before The blocks before the edit.
	 * @param after  The blocks after it.
	 */
	function keepChanges( before: Map< string, BlockState >, after: Map< string, BlockState > ) {
		for ( const [ clientId, state ] of after ) {
			const old = before.get( clientId );
			if ( ! old || ( ! isEqual( old, state ) && isSeen( clientId, old ) ) ) {
				seen.set( clientId, state );
			}
		}
		for ( const clientId of before.keys() ) {
			if ( ! after.has( clientId ) ) {
				seen.delete( clientId );
			}
		}
	}

	return {
		markRead( refs ) {
			for ( const ref of refs ) {
				const clientId = getClientIdByRef( ref );
				const found = clientId ? editor().getBlock( clientId ) : null;
				if ( ! found ) {
					continue;
				}
				const [ block ] = withoutControlledContent( [ found ] );
				// A long block is read without its inner blocks, which are
				// read separately.
				if ( block.innerBlocks.length && serializeWithRefs( [ block ] ).length > LONG_DOCUMENT ) {
					seen.set( block.clientId, toState( block ) );
				} else {
					collect( [ block ], seen );
				}
			}
		},
		findChanged( clientIds ) {
			const blocks = withoutControlledContent(
				editor()
					.getBlocksByClientId( clientIds )
					.filter( ( block ) => block !== null )
			);
			const now = collect( blocks );
			for ( const [ clientId, state ] of now ) {
				if ( ! isSeen( clientId, state ) ) {
					return clientId;
				}
			}
			return undefined;
		},
		track( apply ) {
			const before = collect( getBlocks() );
			const result = apply();
			if ( result.status === 'applied' ) {
				keepChanges( before, collect( getBlocks() ) );
			}
			return result;
		},
	};
}

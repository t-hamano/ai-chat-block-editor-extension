/**
 * A message in a conversation with the AI assistant.
 */
export type AiMessage =
	| {
			role: 'user';
			text: string;
	  }
	| {
			role: 'assistant';
			text: string;
			/**
			 * The edits the assistant made to the document while answering,
			 * in order. The host sends them back to the model as part of
			 * the conversation.
			 */
			edits?: AiEdit[];
			/**
			 * For each edit, the reference IDs of the blocks it added, as
			 * the model was told them. The host tells the model again, so
			 * it can still point at those blocks.
			 */
			editRefs?: string[][];
	  };

/**
 * An edit the AI assistant makes to the document.
 */
export type AiEdit =
	| {
			/**
			 * Replaces the selection it was given.
			 */
			action: 'replace';
			markup: string;
	  }
	| {
			/**
			 * Inserts the markup after the block whose reference ID is
			 * `ref`, or without it, after the selection, or at the end of
			 * the document when nothing is selected.
			 */
			action: 'insert_after';
			markup: string;
			ref?: string;
	  }
	| {
			/**
			 * Edits the block whose reference ID is `ref`, wherever the
			 * selection is: `replace_block` replaces it with the markup,
			 * `insert_before` inserts the markup before it, and
			 * `delete_block` removes it, with an empty markup.
			 */
			action: 'replace_block' | 'insert_before' | 'delete_block';
			ref: string;
			markup: string;
	  }
	| {
			/**
			 * Adds the markup to the end of the document.
			 */
			action: 'append';
			markup: string;
	  }
	| {
			/**
			 * Replaces the one place in the document whose text is `find`
			 * with the markup, wherever the selection is.
			 */
			action: 'replace_text';
			find: string;
			markup: string;
	  };

/**
 * What became of an edit:
 *
 * - `applied`: it changed the document. `refs` has the reference IDs of
 *   the blocks it added, at the level they were added. `autoFix` tells the
 *   model what was fixed in its markup before it was applied.
 * - `dropped`: the selection it was for no longer exists.
 * - `failed`: the model can fix it and try again, for example when its
 *   `find` text is not in the document. `reason` tells the model what went
 *   wrong.
 */
export type AiEditResult =
	| { status: 'applied'; refs?: string[]; autoFix?: string }
	| { status: 'dropped' }
	| { status: 'failed'; reason: string };

/**
 * A request of the model to read the document, which the editor answers
 * without changing it:
 *
 * - `read_blocks`: the markup of the blocks whose reference IDs are `refs`.
 * - `find_blocks`: the blocks whose text has `query`.
 */
export type AiRead =
	{ tool: 'read_blocks'; refs: string[] } | { tool: 'find_blocks'; query: string };

/**
 * What the editor found for a read: `done` with what goes back to the
 * model, or `failed` with what the model can fix.
 */
export type AiReadResult =
	{ status: 'done'; content: string } | { status: 'failed'; reason: string };

/**
 * What the model is doing while it is not writing text: `thinking` while it
 * reasons, `editing` while it writes an edit of the selection, and
 * `reading` while it reads the document.
 */
export type AiActivity = 'thinking' | 'editing' | 'reading';

/**
 * The tokens a request to the model used, as the provider counted them.
 */
export type AiUsage = {
	/**
	 * The tokens the model read, including the conversation and the
	 * instructions sent with it.
	 */
	inputTokens: number;
	/**
	 * The part of `inputTokens` the model read from the prompt cache, for
	 * a fraction of the price. Omitted when the host does not report it.
	 */
	cachedInputTokens?: number;
	/**
	 * The tokens the model wrote, including its thinking.
	 */
	outputTokens: number;
};

/**
 * What the host reports while the model answers.
 */
export type AiStreamEvent =
	| {
			/**
			 * A piece of the answer's text, to append to what came before.
			 */
			type: 'text';
			text: string;
	  }
	| {
			/**
			 * Takes back text at the end of the answer, which the model wrote
			 * before tool calls whose results go back to it. It says what it
			 * did again once it has seen the results.
			 */
			type: 'discard_text';
			text: string;
	  }
	| {
			/**
			 * The model edited the document.
			 */
			type: 'edit';
			edit: AiEdit;
	  }
	| {
			/**
			 * The model started something other than text. Text that
			 * follows ends it. Hosts that cannot tell may leave it out.
			 */
			type: 'activity';
			activity: AiActivity;
	  }
	| {
			/**
			 * What a request to the model used. An answer may take more
			 * than one request, each reported once. Hosts that cannot tell
			 * may leave it out.
			 */
			type: 'usage';
			usage: AiUsage;
	  };

export type AiChatRequest = {
	/**
	 * Instructions for the model, including the selection and the
	 * document it belongs to.
	 */
	system: string;
	/**
	 * The conversation so far, ending with the user's new message.
	 */
	messages: AiMessage[];
	/**
	 * Called for each event while the model answers. For an `edit`, it
	 * applies the edit and returns what became of it, so the host can tell
	 * the model.
	 */
	onEvent: ( event: AiStreamEvent ) => AiEditResult | void;
	/**
	 * Reads the document as it is now, for the model's read tools. Omitted
	 * when the document is not available.
	 */
	read?: ( read: AiRead ) => AiReadResult;
	/**
	 * Aborted when the user stops the answer.
	 */
	signal: AbortSignal;
};

/**
 * Connects the AI assistant to a model. The host keeps the API key and
 * sends the requests, so the editor never sees the key.
 */
export type AiPlatform = {
	/**
	 * Sends the conversation to the model and streams its answer through
	 * `onEvent`. Resolves when the answer ends, and rejects when the
	 * request fails. When `signal` is aborted, rejects with an
	 * `AbortError`.
	 */
	chat: ( request: AiChatRequest ) => Promise< void >;
};

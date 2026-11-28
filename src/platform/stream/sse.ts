/**
 * An event in a stream of Server-Sent Events.
 */
export type SseEvent = {
	/**
	 * The event's name, or `message` when the stream gives none.
	 */
	event: string;
	/**
	 * The event's data. Several `data` lines are joined with newlines.
	 */
	data: string;
};

/**
 * Reads Server-Sent Events from a response body as they arrive.
 *
 * @param body   The response body.
 * @param signal Stops reading when aborted, so the events end there.
 */
export async function* readSse(
	body: ReadableStream< Uint8Array >,
	signal?: AbortSignal
): AsyncGenerator< SseEvent > {
	const reader = body.getReader();
	const cancel = () => {
		reader.cancel().catch( () => {} );
	};
	if ( signal?.aborted ) {
		cancel();
	}
	signal?.addEventListener( 'abort', cancel );
	const decoder = new TextDecoder();
	let buffer = '';
	let event = '';
	let data: string[] = [];

	try {
		while ( true ) {
			const { done, value } = await reader.read();
			buffer += done ? decoder.decode() : decoder.decode( value, { stream: true } );

			// Each line ends with CR LF, LF, or CR. The last piece may be a
			// line that has not fully arrived yet, unless the stream ended.
			const lines = buffer.split( /\r\n|\n|\r/ );
			buffer = done ? '' : ( lines.pop() ?? '' );
			if ( done && lines[ lines.length - 1 ] === '' ) {
				lines.pop();
			}

			for ( const line of lines ) {
				// An empty line ends the event.
				if ( line === '' ) {
					if ( data.length ) {
						yield { event: event || 'message', data: data.join( '\n' ) };
					}
					event = '';
					data = [];
					continue;
				}
				// Lines starting with a colon are comments.
				if ( line.startsWith( ':' ) ) {
					continue;
				}
				const colon = line.indexOf( ':' );
				const field = colon === -1 ? line : line.slice( 0, colon );
				let fieldValue = colon === -1 ? '' : line.slice( colon + 1 );
				if ( fieldValue.startsWith( ' ' ) ) {
					fieldValue = fieldValue.slice( 1 );
				}
				if ( field === 'event' ) {
					event = fieldValue;
				} else if ( field === 'data' ) {
					data.push( fieldValue );
				}
			}

			if ( done ) {
				// A stream that ends without an empty line still ends the last event.
				if ( data.length ) {
					yield { event: event || 'message', data: data.join( '\n' ) };
				}
				return;
			}
		}
	} finally {
		signal?.removeEventListener( 'abort', cancel );
		reader.releaseLock();
	}
}

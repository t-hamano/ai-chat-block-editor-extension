/**
 * Makes a response body that delivers the given pieces one by one, like a
 * stream from the network.
 *
 * @param pieces The pieces of the body.
 */
export function streamBody( pieces: string[] ): ReadableStream< Uint8Array > {
	const encoder = new TextEncoder();
	return new ReadableStream( {
		start( controller ) {
			for ( const piece of pieces ) {
				controller.enqueue( encoder.encode( piece ) );
			}
			controller.close();
		},
	} );
}

<?php
/**
 * @package Blocktune
 */

/**
 * Tests for the Stream class.
 */
class Test_Stream extends WP_UnitTestCase {

	/**
	 * Tests that the request goes through the WordPress HTTP API, and that an
	 * answer that comes whole, as it does without cURL, is passed on.
	 */
	public function test_passes_a_whole_answer_on() {
		$sent = null;
		add_filter(
			'pre_http_request',
			static function ( $response, $args, $url ) use ( &$sent ) {
				$sent = array( $url, $args['body'] );
				return array(
					'headers'  => array( 'content-type' => 'text/event-stream' ),
					'body'     => "data: {}\n\n",
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'cookies'  => array(),
					'filename' => null,
				);
			},
			10,
			3
		);
		$stream = new Blocktune_Test_Stream();

		$this->expectOutputString( "data: {}\n\n" );

		$this->assertNull( $stream->send_and_stream_response( 'https://api.example.com/', array(), '{"a":1}' ) );
		$this->assertSame( array( 'https://api.example.com/', '{"a":1}' ), $sent );
		$this->assertSame( array( 200, 'text/event-stream' ), $stream->started_with );
	}

	/**
	 * Tests that a request the site does not allow is an error.
	 */
	public function test_blocked_request_is_an_error() {
		add_filter(
			'pre_http_request',
			static fn() => new WP_Error( 'http_request_not_executed', 'User has blocked requests through HTTP.' )
		);

		$error = ( new Blocktune_Test_Stream() )->send_and_stream_response( 'https://api.example.com/', array(), '{}' );

		$this->assertWPError( $error );
		$this->assertSame( 502, $error->get_error_data()['status'] );
	}

	/**
	 * Tests that an answer that stopped partway ends with an event that says why.
	 */
	public function test_sends_an_error_event() {
		$stream = new Blocktune_Test_Stream();

		$this->expectOutputRegex( '/^\n\nevent: blocktune_error\ndata: \{"message":"The provider took too long[^"]*"\}\n\n$/' );

		$stream->send_error_event( true );
	}

	/**
	 * Tests that an error is returned when the provider cannot be reached.
	 */
	public function test_unreachable_provider_is_an_error() {
		$error = ( new Blocktune_Test_Stream() )->send_and_stream_response( 'http://127.0.0.1:9/', array(), '{}' );

		$this->assertWPError( $error );
		$this->assertSame( 502, $error->get_error_data()['status'] );
	}
}

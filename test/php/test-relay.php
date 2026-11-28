<?php
/**
 * @package Blocktune
 */

/**
 * Tests for the Relay class.
 */
class Test_Relay extends WP_UnitTestCase {

	use Blocktune_Fake_Api_Key;

	/**
	 * The request that was sent to the provider, if any.
	 *
	 * @var array|null
	 */
	private $sent;

	/**
	 * An administrator and a post they can edit.
	 */
	public function set_up() {
		parent::set_up();

		$this->sent = null;
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->set_fake_api_key( 'test-key' );

		// Record the request to the provider and answer it, instead of sending it.
		add_filter(
			'pre_http_request',
			function ( $response, $args, $url ) {
				$this->sent = array(
					'url'  => $url,
					'args' => $args,
				);
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode( array( 'content' => array( array( 'text' => 'Hi' ) ) ) ),
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
	}

	/**
	 * Sends a chat request to the route.
	 *
	 * @param array $params The request parameters.
	 * @return WP_REST_Response
	 */
	private function chat( array $params = array() ) {
		$request = new WP_REST_Request( 'POST', '/' . BLOCKTUNE_NAMESPACE . '/v1/chat' );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array_merge(
					array(
						'provider' => 'anthropic',
						'body'     => array(
							'model'    => 'test-model',
							'messages' => array(),
							'stream'   => true,
						),
					),
					$params
				)
			)
		);

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Tests that the request goes to the provider with the key, and the answer comes back.
	 */
	public function test_relays_the_request() {
		$response = $this->chat();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Hi', $response->get_data()['content'][0]['text'] );
		$this->assertSame( 'https://api.anthropic.com/v1/messages', $this->sent['url'] );
		$this->assertSame( 'test-key', $this->sent['args']['headers']['x-api-key'] );
		$this->assertSame( '2023-06-01', $this->sent['args']['headers']['anthropic-version'] );
		$this->assertSame( 0, $this->sent['args']['redirection'] );

		$body = json_decode( $this->sent['args']['body'], true );
		$this->assertSame( 'test-model', $body['model'] );
		$this->assertFalse( $body['stream'] );
		$this->assertSame( 64000, $body['max_tokens'] );
	}

	/**
	 * Tests that the token limit is set on the server, whatever the body asks for.
	 */
	public function test_token_limit_is_set_on_the_server() {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );

		$this->chat(
			array(
				'provider' => 'openai',
				'body'     => array(
					'model'             => 'test-model',
					'max_output_tokens' => 1000000,
					'input'             => array(),
				),
			)
		);

		$body = json_decode( $this->sent['args']['body'], true );
		$this->assertSame( 64000, $body['max_output_tokens'] );
	}

	/**
	 * Tests that the editor's own function tools are passed on.
	 *
	 * @dataProvider data_function_tools
	 *
	 * @param string $provider The provider ID.
	 * @param array  $body     The request body.
	 */
	public function test_function_tools_are_passed_on( $provider, $body ) {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );
		$this->set_fake_api_key( 'google-key', Blocktune_Fake_Google_Provider::class );

		$response = $this->chat(
			array(
				'provider' => $provider,
				'body'     => $body,
			)
		);

		$this->assertSame( 200, $response->get_status() );

		$sent = json_decode( $this->sent['args']['body'], true );
		$this->assertSame( $body['tools'], $sent['tools'] );
	}

	/**
	 * Bodies with the editor's own function tools.
	 *
	 * @return array
	 */
	public static function data_function_tools() {
		return array(
			'Anthropic' => array(
				'anthropic',
				array(
					'model'    => 'test-model',
					'tools'    => array(
						array(
							'name'                  => 'edit_blocks',
							'description'           => 'Edits the document.',
							'eager_input_streaming' => true,
							'input_schema'          => array( 'type' => 'object' ),
						),
					),
					'messages' => array(),
				),
			),
			'OpenAI'    => array(
				'openai',
				array(
					'model' => 'test-model',
					'tools' => array(
						array(
							'type'        => 'function',
							'name'        => 'edit_blocks',
							'description' => 'Edits the document.',
							'parameters'  => array( 'type' => 'object' ),
							'strict'      => false,
						),
					),
					'input' => array(),
				),
			),
			'Google'    => array(
				'google',
				array(
					'model'    => 'gemini-test',
					'tools'    => array(
						array(
							'functionDeclarations' => array(
								array(
									'name'        => 'edit_blocks',
									'description' => 'Edits the document.',
									'parameters'  => array( 'type' => 'object' ),
								),
							),
						),
					),
					'contents' => array(),
				),
			),
		);
	}

	/**
	 * Tests that the effort is passed on.
	 *
	 * @dataProvider data_efforts
	 *
	 * @param string $provider The provider ID.
	 * @param array  $body     The request body.
	 * @param string $field    The field that sets the effort.
	 */
	public function test_effort_is_passed_on( $provider, $body, $field ) {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );

		$response = $this->chat(
			array(
				'provider' => $provider,
				'body'     => $body,
			)
		);

		$this->assertSame( 200, $response->get_status() );

		$sent = json_decode( $this->sent['args']['body'], true );
		$this->assertSame( $body[ $field ], $sent[ $field ] );
	}

	/**
	 * Bodies that set the effort.
	 *
	 * @return array
	 */
	public static function data_efforts() {
		return array(
			'Anthropic' => array(
				'anthropic',
				array(
					'model'         => 'test-model',
					'messages'      => array(),
					'output_config' => array( 'effort' => 'medium' ),
				),
				'output_config',
			),
			'OpenAI'    => array(
				'openai',
				array(
					'model'     => 'test-model',
					'input'     => array(),
					'reasoning' => array( 'effort' => 'low' ),
				),
				'reasoning',
			),
		);
	}

	/**
	 * Tests that a body that asks for more than the editor sends is rejected.
	 *
	 * @dataProvider data_invalid_bodies
	 *
	 * @param string $provider The provider ID.
	 * @param array  $body     The request body.
	 */
	public function test_invalid_body_is_rejected( $provider, $body ) {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );
		$this->set_fake_api_key( 'google-key', Blocktune_Fake_Google_Provider::class );

		$response = $this->chat(
			array(
				'provider' => $provider,
				'body'     => $body,
			)
		);

		$this->assertSame( 'blocktune_invalid_body', $response->as_error()->get_error_code() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Bodies that ask for more than the editor sends.
	 *
	 * @return array
	 */
	public static function data_invalid_bodies() {
		return array(
			'unknown field'           => array(
				'anthropic',
				array(
					'model'    => 'test-model',
					'messages' => array(),
					'metadata' => array(),
				),
			),
			'Anthropic server tool'   => array(
				'anthropic',
				array(
					'model'    => 'test-model',
					'tools'    => array(
						array(
							'type' => 'web_search_20250305',
							'name' => 'web_search',
						),
					),
					'messages' => array(),
				),
			),
			'OpenAI built-in tool'    => array(
				'openai',
				array(
					'model' => 'test-model',
					'tools' => array( array( 'type' => 'web_search' ) ),
					'input' => array(),
				),
			),
			'Google search tool'      => array(
				'google',
				array(
					'model'    => 'gemini-test',
					'tools'    => array( array( 'googleSearch' => array() ) ),
					'contents' => array(),
				),
			),
			'Anthropic output format' => array(
				'anthropic',
				array(
					'model'         => 'test-model',
					'messages'      => array(),
					'output_config' => array( 'format' => array( 'type' => 'json_schema' ) ),
				),
			),
			'Google candidates'       => array(
				'google',
				array(
					'model'            => 'gemini-test',
					'contents'         => array(),
					'generationConfig' => array( 'candidateCount' => 8 ),
				),
			),
		);
	}

	/**
	 * Tests that OpenAI requests go to OpenAI, with the key as a bearer token.
	 */
	public function test_relays_the_request_to_openai() {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );

		$response = $this->chat(
			array(
				'provider' => 'openai',
				'body'     => array(
					'model' => 'test-model',
					'input' => array(),
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'https://api.openai.com/v1/responses', $this->sent['url'] );
		$this->assertSame( 'Bearer openai-key', $this->sent['args']['headers']['authorization'] );
		$this->assertArrayNotHasKey( 'x-api-key', $this->sent['args']['headers'] );
	}

	/**
	 * Tests that each provider uses its own key.
	 */
	public function test_openai_needs_its_own_key() {
		$response = $this->chat( array( 'provider' => 'openai' ) );

		$this->assertSame( 'blocktune_no_api_key', $response->as_error()->get_error_code() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Tests that Google requests go to the model's address, with the model and
	 * `stream` taken out of the body.
	 */
	public function test_relays_the_request_to_google() {
		$this->set_fake_api_key( 'google-key', Blocktune_Fake_Google_Provider::class );

		$response = $this->chat(
			array(
				'provider' => 'google',
				'body'     => array(
					'model'    => 'gemini-test',
					'contents' => array(),
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent', $this->sent['url'] );
		$this->assertSame( 'google-key', $this->sent['args']['headers']['x-goog-api-key'] );
		$this->assertArrayNotHasKey( 'x-api-key', $this->sent['args']['headers'] );

		$body = json_decode( $this->sent['args']['body'], true );
		$this->assertSame(
			array(
				'contents'         => array(),
				'generationConfig' => array( 'maxOutputTokens' => 64000 ),
			),
			$body
		);
	}

	/**
	 * Tests that a Google model that would change the address is rejected.
	 *
	 * @dataProvider data_invalid_google_models
	 *
	 * @param mixed $model The model.
	 */
	public function test_invalid_google_model_is_rejected( $model ) {
		$this->set_fake_api_key( 'google-key', Blocktune_Fake_Google_Provider::class );

		$response = $this->chat(
			array(
				'provider' => 'google',
				'body'     => array( 'model' => $model ),
			)
		);

		$this->assertSame( 'blocktune_invalid_model', $response->as_error()->get_error_code() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Models that must not be put in the address.
	 *
	 * @return array
	 */
	public static function data_invalid_google_models() {
		return array(
			'missing'  => array( null ),
			'empty'    => array( '' ),
			'path'     => array( '../files/x' ),
			'query'    => array( 'gemini?key=x' ),
			'host'     => array( '@example.com' ),
			'not text' => array( array( 'gemini' ) ),
		);
	}

	/**
	 * Tests that editors cannot use the route.
	 */
	public function test_editor_cannot_chat() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertSame( 403, $this->chat()->get_status() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Tests that other providers are not accepted.
	 */
	public function test_unknown_provider_is_rejected() {
		$this->assertSame( 400, $this->chat( array( 'provider' => 'example' ) )->get_status() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Tests that nothing is sent without a key.
	 */
	public function test_nothing_is_sent_without_api_key() {
		$this->set_fake_api_key( '' );

		$response = $this->chat();

		$this->assertSame( 'blocktune_no_api_key', $response->as_error()->get_error_code() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Tests that nothing is sent when a filter prevents prompts.
	 */
	public function test_nothing_is_sent_when_prompts_are_prevented() {
		add_filter( 'wp_ai_client_prevent_prompt', '__return_true' );

		$response = $this->chat();

		$this->assertSame( 503, $response->get_status() );
		$this->assertSame( 'Prompt execution was prevented by a filter.', $response->as_error()->get_error_message() );
		$this->assertNull( $this->sent );
	}

	/**
	 * Tests that nothing is sent when the site does not support AI.
	 */
	public function test_nothing_is_sent_when_ai_is_not_supported() {
		add_filter( 'wp_supports_ai', '__return_false' );

		$response = $this->chat();

		$this->assertSame( 503, $response->get_status() );
		$this->assertSame( 'AI features are not supported in this environment.', $response->as_error()->get_error_message() );
		$this->assertNull( $this->sent );
	}
}

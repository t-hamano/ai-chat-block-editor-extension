<?php
/**
 * @package Blocktune
 */

/**
 * Tests for the Models class.
 */
class Test_Models extends WP_UnitTestCase {

	use Blocktune_Fake_Api_Key;

	/**
	 * The requests that were sent to the provider.
	 *
	 * @var array
	 */
	private $sent;

	/**
	 * What the provider answers: an HTTP response array, or a WP_Error.
	 *
	 * @var array|WP_Error
	 */
	private $answer;

	/**
	 * An administrator, a key, and a provider that lists two models.
	 */
	public function set_up() {
		parent::set_up();

		$this->sent   = array();
		$this->answer = $this->response(
			200,
			array(
				'data' => array(
					array(
						'id'           => 'model-a',
						'display_name' => 'Model A',
					),
					array( 'id' => 'model-b' ),
					array( 'display_name' => 'No ID' ),
				),
			)
		);

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->set_fake_api_key( 'test-key' );

		// Record the request to the provider and answer it, instead of sending it.
		add_filter(
			'pre_http_request',
			function ( $response, $args, $url ) {
				$this->sent[] = array(
					'url'  => $url,
					'args' => $args,
				);
				return $this->answer;
			},
			10,
			3
		);
	}

	/**
	 * Builds an HTTP response.
	 *
	 * @param int   $code The status.
	 * @param array $body The JSON body.
	 * @return array
	 */
	private function response( int $code, array $body ) {
		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $body ),
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Asks the route for the models.
	 *
	 * @param string $provider The provider ID.
	 * @return WP_REST_Response
	 */
	private function list_models( string $provider = 'anthropic' ) {
		$request = new WP_REST_Request( 'GET', '/' . BLOCKTUNE_NAMESPACE . '/v1/models' );
		$request->set_param( 'provider', $provider );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Tests that the models come from the provider with the key.
	 */
	public function test_lists_the_models() {
		$response = $this->list_models();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				array(
					'id'   => 'model-a',
					'name' => 'Model A',
				),
				array(
					'id'   => 'model-b',
					'name' => 'model-b',
				),
			),
			$response->get_data()
		);
		$this->assertSame( 'https://api.anthropic.com/v1/models?limit=1000', $this->sent[0]['url'] );
		$this->assertSame( 'test-key', $this->sent[0]['args']['headers']['x-api-key'] );
		$this->assertSame( '2023-06-01', $this->sent[0]['args']['headers']['anthropic-version'] );
		$this->assertSame( 0, $this->sent[0]['args']['redirection'] );
	}

	/**
	 * Tests that OpenAI's models are listed with the key as a bearer token.
	 */
	public function test_lists_the_openai_models() {
		$this->set_fake_api_key( 'openai-key', Blocktune_Fake_OpenAI_Provider::class );

		$response = $this->list_models( 'openai' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'https://api.openai.com/v1/models', $this->sent[0]['url'] );
		$this->assertSame( 'Bearer openai-key', $this->sent[0]['args']['headers']['authorization'] );
	}

	/**
	 * Tests that Google's models are listed by their ID, without the models that cannot chat.
	 */
	public function test_lists_the_google_models() {
		$this->set_fake_api_key( 'google-key', Blocktune_Fake_Google_Provider::class );
		$this->answer = $this->response(
			200,
			array(
				'models' => array(
					array(
						'name'                       => 'models/gemini-a',
						'displayName'                => 'Gemini A',
						'supportedGenerationMethods' => array( 'generateContent', 'countTokens' ),
					),
					array(
						'name'                       => 'models/embedding-a',
						'displayName'                => 'Embedding A',
						'supportedGenerationMethods' => array( 'embedContent' ),
					),
					array( 'name' => 'models/gemini-b' ),
					array( 'displayName' => 'No name' ),
				),
			)
		);

		$response = $this->list_models( 'google' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame(
			array(
				array(
					'id'   => 'gemini-a',
					'name' => 'Gemini A',
				),
				array(
					'id'   => 'gemini-b',
					'name' => 'gemini-b',
				),
			),
			$response->get_data()
		);
		$this->assertSame( 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', $this->sent[0]['url'] );
		$this->assertSame( 'google-key', $this->sent[0]['args']['headers']['x-goog-api-key'] );
	}

	/**
	 * Tests that the list is kept, so the provider is asked only once.
	 */
	public function test_keeps_the_list() {
		$this->list_models();
		$response = $this->list_models();

		$this->assertSame( 'model-a', $response->get_data()[0]['id'] );
		$this->assertCount( 1, $this->sent );
	}

	/**
	 * Tests that a new key gets a new list.
	 */
	public function test_new_key_asks_again() {
		$this->list_models();
		$this->set_fake_api_key( 'other-key' );
		$this->list_models();

		$this->assertCount( 2, $this->sent );
		$this->assertSame( 'other-key', $this->sent[1]['args']['headers']['x-api-key'] );
	}

	/**
	 * Tests that a failed answer is an error and is not kept.
	 */
	public function test_failure_is_not_kept() {
		$this->answer = $this->response( 401, array( 'error' => array( 'message' => 'invalid x-api-key' ) ) );

		$response = $this->list_models();

		$this->assertSame( 'blocktune_models_unavailable', $response->as_error()->get_error_code() );

		$this->answer = $this->response( 200, array( 'data' => array( array( 'id' => 'model-a' ) ) ) );

		$this->assertSame( 200, $this->list_models()->get_status() );
		$this->assertCount( 2, $this->sent );
	}

	/**
	 * Tests that an unreachable provider is an error.
	 */
	public function test_unreachable_provider() {
		$this->answer = new WP_Error( 'http_request_failed', 'Could not connect' );

		$response = $this->list_models();

		$this->assertSame( 502, $response->get_status() );
		$this->assertSame( 'blocktune_provider_unreachable', $response->as_error()->get_error_code() );
	}

	/**
	 * Tests that nothing is sent without a key.
	 */
	public function test_nothing_is_sent_without_api_key() {
		$this->set_fake_api_key( '' );

		$response = $this->list_models();

		$this->assertSame( 'blocktune_no_api_key', $response->as_error()->get_error_code() );
		$this->assertCount( 0, $this->sent );
	}

	/**
	 * Tests that editors cannot use the route.
	 */
	public function test_editor_cannot_list_models() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertSame( 403, $this->list_models()->get_status() );
		$this->assertCount( 0, $this->sent );
	}

	/**
	 * Tests that other providers are not accepted.
	 */
	public function test_unknown_provider_is_rejected() {
		$this->assertSame( 400, $this->list_models( 'example' )->get_status() );
		$this->assertCount( 0, $this->sent );
	}
}

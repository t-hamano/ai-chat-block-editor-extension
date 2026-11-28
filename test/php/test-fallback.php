<?php
/**
 * @package Blocktune
 */

use WordPress\AiClient\AiClient;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\DTO\ModelMessage;
use WordPress\AiClient\Tools\DTO\FunctionCall;

/**
 * Tests for the Fallback class.
 */
class Test_Fallback extends WP_UnitTestCase {

	/**
	 * An administrator, and a provider that records the prompt.
	 */
	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		$registry = AiClient::defaultRegistry();
		if ( ! $registry->hasProvider( Blocktune_Fallback_Provider::ID ) ) {
			$registry->registerProvider( Blocktune_Fallback_Provider::class );
		}

		Blocktune_Fallback_Provider::$prompt = null;
		Blocktune_Fallback_Provider::$answer = null;
	}

	/**
	 * Sends a conversation to the route.
	 *
	 * @param array $params The request parameters.
	 * @return WP_REST_Response
	 */
	private function chat( array $params = array() ) {
		$request = new WP_REST_Request( 'POST', '/' . BLOCKTUNE_NAMESPACE . '/v1/fallback' );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array_merge(
					array(
						'system'   => 'Be brief.',
						'messages' => array(
							array(
								'role'  => 'user',
								'parts' => array( array( 'text' => 'Hello' ) ),
							),
						),
						'models'   => array( array( Blocktune_Fallback_Provider::ID, 'test-model' ) ),
					),
					$params
				)
			)
		);

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Tests that the conversation goes through the AI Client and the answer comes back.
	 */
	public function test_returns_the_answer() {
		$response = $this->chat();
		$data     = $response->get_data();

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'model', $data['message']['role'] );
		$this->assertSame( 'Hi', $data['message']['parts'][0]['text'] );
		$this->assertSame( 'stop', $data['finishReason'] );
		$this->assertSame(
			array(
				'inputTokens'  => 12,
				'outputTokens' => 3,
			),
			$data['usage']
		);
		$this->assertSame( Blocktune_Fallback_Provider::ID, $data['provider'] );
		$this->assertSame( 'test-model', $data['model'] );

		$prompt = Blocktune_Fallback_Provider::$prompt;
		$this->assertSame( 'Hello', $prompt['messages'][0]['parts'][0]['text'] );
		$this->assertSame( 'Be brief.', $prompt['config']->getSystemInstruction() );
	}

	/**
	 * Tests that the first preferred model that is available answers.
	 */
	public function test_uses_the_preferred_model() {
		$this->chat(
			array(
				'models' => array(
					array( Blocktune_Fallback_Provider::ID, 'retired-model' ),
					array( Blocktune_Fallback_Provider::ID, 'other-model' ),
				),
			)
		);

		$this->assertSame( 'other-model', Blocktune_Fallback_Provider::$prompt['model'] );
	}

	/**
	 * Tests that the AI Client chooses a model without preferences.
	 */
	public function test_ai_client_chooses_without_preferences() {
		$response = $this->chat( array( 'models' => array() ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertNotNull( Blocktune_Fallback_Provider::$prompt );
	}

	/**
	 * Tests that tools are declared, and the model's tool calls come back.
	 */
	public function test_passes_tools_and_returns_tool_calls() {
		Blocktune_Fallback_Provider::$answer = new ModelMessage(
			array( new MessagePart( new FunctionCall( 'call-1', 'edit_blocks', array( 'action' => 'replace' ) ) ) )
		);

		$response = $this->chat(
			array(
				'tools' => array(
					array(
						'name'        => 'edit_blocks',
						'description' => 'Edits the document.',
						'parameters'  => array(
							'type'       => 'object',
							'properties' => array( 'action' => array( 'type' => 'string' ) ),
						),
					),
				),
			)
		);

		$declarations = Blocktune_Fallback_Provider::$prompt['config']->getFunctionDeclarations();
		$this->assertSame( 'edit_blocks', $declarations[0]->getName() );
		$this->assertSame( 'object', $declarations[0]->getParameters()['type'] );

		$call = $response->get_data()['message']['parts'][0]['functionCall'];
		$this->assertSame( 'call-1', $call['id'] );
		$this->assertSame( 'edit_blocks', $call['name'] );
		$this->assertSame( array( 'action' => 'replace' ), $call['args'] );
	}

	/**
	 * Tests that the history, with tool calls and their results, is sent in order.
	 */
	public function test_sends_the_history_with_tool_results() {
		$messages = array(
			array(
				'role'  => 'user',
				'parts' => array( array( 'text' => 'Make it shorter' ) ),
			),
			array(
				'role'  => 'model',
				'parts' => array(
					array(
						'functionCall' => array(
							'id'   => 'call-1',
							'name' => 'edit_blocks',
							'args' => array( 'action' => 'replace' ),
						),
					),
				),
			),
			array(
				'role'  => 'user',
				'parts' => array(
					array(
						'functionResponse' => array(
							'id'       => 'call-1',
							'name'     => 'edit_blocks',
							'response' => 'The edit was applied.',
						),
					),
				),
			),
		);

		$this->assertSame( 200, $this->chat( array( 'messages' => $messages ) )->get_status() );

		$sent = Blocktune_Fallback_Provider::$prompt['messages'];
		$this->assertCount( 3, $sent );
		$this->assertSame( 'Make it shorter', $sent[0]['parts'][0]['text'] );
		$this->assertSame( 'call-1', $sent[1]['parts'][0]['functionCall']['id'] );
		$this->assertSame( 'The edit was applied.', $sent[2]['parts'][0]['functionResponse']['response'] );
	}

	/**
	 * Tests that files are not accepted, so the AI Client never reads a path or URL.
	 */
	public function test_files_are_rejected() {
		$response = $this->chat(
			array(
				'messages' => array(
					array(
						'role'  => 'user',
						'parts' => array(
							array(
								'file' => array(
									'fileType' => 'remote',
									'url'      => 'file:///etc/passwd',
									'mimeType' => 'text/plain',
								),
							),
						),
					),
				),
			)
		);

		$this->assertSame( 'blocktune_invalid_conversation', $response->as_error()->get_error_code() );
		$this->assertNull( Blocktune_Fallback_Provider::$prompt );
	}

	/**
	 * Tests that a conversation the AI Client cannot read is rejected.
	 */
	public function test_invalid_conversation_is_rejected() {
		$response = $this->chat(
			array(
				'messages' => array(
					array(
						'role'  => 'model',
						'parts' => array( array( 'text' => 'Hi' ) ),
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertNull( Blocktune_Fallback_Provider::$prompt );
	}

	/**
	 * Tests that editors cannot use the route.
	 */
	public function test_editor_cannot_chat() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$this->assertSame( 403, $this->chat()->get_status() );
		$this->assertNull( Blocktune_Fallback_Provider::$prompt );
	}

	/**
	 * Tests that nothing is sent when a filter prevents prompts.
	 */
	public function test_nothing_is_sent_when_prompts_are_prevented() {
		add_filter( 'wp_ai_client_prevent_prompt', '__return_true' );

		$this->assertSame( 503, $this->chat()->get_status() );
		$this->assertNull( Blocktune_Fallback_Provider::$prompt );
	}

	/**
	 * Tests that nothing is sent when the site does not support AI.
	 */
	public function test_nothing_is_sent_when_ai_is_not_supported() {
		add_filter( 'wp_supports_ai', '__return_false' );

		$this->assertSame( 503, $this->chat()->get_status() );
		$this->assertNull( Blocktune_Fallback_Provider::$prompt );
	}
}

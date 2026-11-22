<?php
/**
 * @package AI_Chat_Block_Editor_Extension
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace AI_Chat_Block_Editor_Extension;

use InvalidArgumentException;
use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Tools\DTO\FunctionDeclaration;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Sends a conversation through the AI Client and returns the whole answer
 * at once.
 *
 * It is used for providers the relay does not know, and when the relay
 * cannot read a provider's key. The AI Client picks the provider and model
 * and adds the key itself.
 *
 * The editor sends the conversation in the AI Client's own message format,
 * including the tools the model called and what they returned, and runs the
 * tools itself.
 */
class Fallback {

	/**
	 * The kinds of message parts the editor may send. Files are not
	 * accepted, because the AI Client would read local paths and fetch URLs.
	 */
	const PART_KEYS = array( 'text', 'functionCall', 'functionResponse' );

	/**
	 * Constructor
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Registers the fallback route
	 */
	public function register_routes() {
		register_rest_route(
			AI_CHAT_BLOCK_EDITOR_EXTENSION_NAMESPACE . '/v1',
			'/fallback',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'chat' ),
				'permission_callback' => array( $this, 'can_chat' ),
				'args'                => array(
					'post_id'  => array(
						'type'     => 'integer',
						'required' => true,
					),
					'system'   => array(
						'type'    => 'string',
						'default' => '',
					),
					'messages' => array(
						'type'     => 'array',
						'items'    => array(
							'type'       => 'object',
							'properties' => array(
								'role'  => array(
									'type' => 'string',
									'enum' => array( 'user', 'model' ),
								),
								'parts' => array(
									'type'     => 'array',
									'items'    => array( 'type' => 'object' ),
									'minItems' => 1,
								),
							),
							'required'   => array( 'role', 'parts' ),
						),
						'minItems' => 1,
						'required' => true,
					),
					'tools'    => array(
						'type'    => 'array',
						'items'   => array(
							'type'       => 'object',
							'properties' => array(
								'name'        => array( 'type' => 'string' ),
								'description' => array( 'type' => 'string' ),
								'parameters'  => array( 'type' => 'object' ),
							),
							'required'   => array( 'name', 'description' ),
						),
						'default' => array(),
					),
					'models'   => array(
						'description' => __( 'The preferred models in order, as [provider ID, model ID] pairs. The AI Client chooses when none of them is available.', 'ai-chat-block-editor-extension' ),
						'type'        => 'array',
						'items'       => array(
							'type'     => 'array',
							'items'    => array( 'type' => 'string' ),
							'minItems' => 2,
							'maxItems' => 2,
						),
						'default'     => array(),
					),
				),
			)
		);
	}

	/**
	 * Whether the current user can chat about the post
	 *
	 * @param WP_REST_Request $request The request.
	 * @return bool
	 */
	public function can_chat( WP_REST_Request $request ) {
		return Enqueue::can_use() && current_user_can( 'edit_post', $request->get_param( 'post_id' ) );
	}

	/**
	 * Sends the conversation and returns the model's answer
	 *
	 * The AI Client returns an error itself when AI is turned off on the
	 * site, or `wp_ai_client_prevent_prompt` stops the prompt.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function chat( WP_REST_Request $request ) {
		try {
			$messages = array_map(
				static function ( array $message ): Message {
					foreach ( $message['parts'] as $part ) {
						if ( ! array_intersect( array_keys( $part ), self::PART_KEYS ) || isset( $part['file'] ) ) {
							throw new InvalidArgumentException( esc_html__( 'Messages may only contain text, tool calls, and tool results.', 'ai-chat-block-editor-extension' ) );
						}
					}

					return Message::fromArray( $message );
				},
				$request->get_param( 'messages' )
			);
			$tools    = array_map(
				static fn( $tool ) => FunctionDeclaration::fromArray( $tool ),
				$request->get_param( 'tools' )
			);
		} catch ( InvalidArgumentException $e ) {
			return new WP_Error(
				'ai_chat_block_editor_extension_invalid_conversation',
				$e->getMessage(),
				array( 'status' => 400 )
			);
		}

		$prompt = wp_ai_client_prompt( $messages );
		$system = $request->get_param( 'system' );
		$models = $request->get_param( 'models' );

		if ( '' !== $system ) {
			$prompt->using_system_instruction( $system );
		}

		if ( $tools ) {
			$prompt->using_function_declarations( ...$tools );
		}

		if ( $models ) {
			$prompt->using_model_preference( ...$models );
		}

		$result = $prompt->generate_text_result();

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$candidate = $result->getCandidates()[0];
		$usage     = $result->getTokenUsage();

		return new WP_REST_Response(
			array(
				'message'      => $candidate->getMessage()->toArray(),
				'finishReason' => $candidate->getFinishReason()->value,
				'usage'        => array(
					'inputTokens'  => $usage->getPromptTokens(),
					'outputTokens' => $usage->getCompletionTokens(),
				),
				'provider'     => $result->getProviderMetadata()->getId(),
				'model'        => $result->getModelMetadata()->getId(),
			)
		);
	}
}

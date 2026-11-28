<?php
/**
 * Plugin Name: Blocktune E2E Fake Provider
 * Description: Answers Blocktune's requests to Anthropic with answers that the end-to-end tests set, so the tests need no API key and send nothing to the provider.
 *
 * @package Blocktune
 */

defined( 'ABSPATH' ) || exit;

use WordPress\AiClient\AiClient;
use WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication;

/**
 * The fake API key, which never leaves the site.
 */
const BLOCKTUNE_E2E_API_KEY = 'blocktune-e2e-key';

/**
 * The option that holds the answers to give, in order.
 */
const BLOCKTUNE_E2E_ANSWERS = 'blocktune_e2e_answers';

/**
 * The option that holds the requests the site sent to the provider.
 */
const BLOCKTUNE_E2E_REQUESTS = 'blocktune_e2e_requests';

/**
 * Gives Anthropic a fake API key, after Connectors passes the saved keys on.
 */
function blocktune_e2e_set_api_key() {
	$registry = AiClient::defaultRegistry();

	if ( $registry->hasProvider( 'anthropic' ) ) {
		$registry->setProviderRequestAuthentication( 'anthropic', new ApiKeyRequestAuthentication( BLOCKTUNE_E2E_API_KEY ) );
	}
}
add_action( 'init', 'blocktune_e2e_set_api_key', 30 );

/**
 * Registers the route that the tests set the answers with and read the
 * requests from.
 */
function blocktune_e2e_register_routes() {
	register_rest_route(
		'blocktune-e2e/v1',
		'/answers',
		array(
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => static function ( WP_REST_Request $request ) {
					update_option( BLOCKTUNE_E2E_ANSWERS, (array) $request->get_param( 'answers' ), false );
					update_option( BLOCKTUNE_E2E_REQUESTS, array(), false );
					return new WP_REST_Response( null, 204 );
				},
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			),
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => static function () {
					return get_option( BLOCKTUNE_E2E_REQUESTS, array() );
				},
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			),
		)
	);
}
add_action( 'rest_api_init', 'blocktune_e2e_register_routes' );

/**
 * Answers the requests to Anthropic instead of sending them.
 *
 * @param false|array|WP_Error $response A response to use instead, or false.
 * @param array                $args     The request arguments.
 * @param string               $url      The request address.
 * @return false|array
 */
function blocktune_e2e_answer( $response, $args, $url ) {
	if ( str_starts_with( $url, 'https://api.anthropic.com/v1/models' ) ) {
		return blocktune_e2e_response(
			200,
			'application/json',
			wp_json_encode(
				array(
					'data' => array(
						array(
							'id'           => 'claude-sonnet-5-5',
							'display_name' => 'Claude Sonnet 5.5',
						),
					),
				)
			)
		);
	}

	if ( 'https://api.anthropic.com/v1/messages' !== $url ) {
		return $response;
	}

	$body     = json_decode( $args['body'], true );
	$requests = get_option( BLOCKTUNE_E2E_REQUESTS, array() );

	$requests[] = array(
		'api_key' => $args['headers']['x-api-key'] ?? null,
		'body'    => $body,
	);
	update_option( BLOCKTUNE_E2E_REQUESTS, $requests, false );

	$answers = get_option( BLOCKTUNE_E2E_ANSWERS, array() );
	$answer  = array_shift( $answers );
	update_option( BLOCKTUNE_E2E_ANSWERS, $answers, false );

	if ( ! is_array( $answer ) ) {
		$answer = array(
			'status' => 500,
			'error'  => 'No answer was set for this request.',
		);
	}

	if ( isset( $answer['error'] ) ) {
		return blocktune_e2e_response(
			$answer['status'] ?? 400,
			'application/json',
			wp_json_encode(
				array(
					'type'  => 'error',
					'error' => array(
						'type'    => 'invalid_request_error',
						'message' => $answer['error'],
					),
				)
			)
		);
	}

	$message = array(
		'id'          => 'msg_e2e',
		'type'        => 'message',
		'role'        => 'assistant',
		'model'       => $body['model'] ?? '',
		'content'     => $answer['content'] ?? array(),
		'stop_reason' => $answer['stop_reason'] ?? 'end_turn',
		'usage'       => $answer['usage'] ?? array(
			'input_tokens'  => 100,
			'output_tokens' => 20,
		),
	);

	if ( empty( $body['stream'] ) ) {
		return blocktune_e2e_response( 200, 'application/json', wp_json_encode( $message ) );
	}

	return blocktune_e2e_response( 200, 'text/event-stream', blocktune_e2e_to_events( $message ) );
}
add_filter( 'pre_http_request', 'blocktune_e2e_answer', 10, 3 );

/**
 * Builds a response for `pre_http_request`.
 *
 * @param int    $status       The HTTP status.
 * @param string $content_type The content type.
 * @param string $body         The body.
 * @return array
 */
function blocktune_e2e_response( int $status, string $content_type, string $body ) {
	return array(
		'headers'  => array( 'content-type' => $content_type ),
		'body'     => $body,
		'response' => array(
			'code'    => $status,
			'message' => get_status_header_desc( $status ),
		),
		'cookies'  => array(),
		'filename' => null,
	);
}

/**
 * Turns an answer into the events Anthropic streams it as.
 *
 * @param array $message The answer.
 * @return string The events.
 */
function blocktune_e2e_to_events( array $message ) {
	$events = array(
		array(
			'message_start',
			array(
				'type'    => 'message_start',
				'message' => array_merge(
					$message,
					array(
						'content'     => array(),
						'stop_reason' => null,
					)
				),
			),
		),
	);

	foreach ( $message['content'] as $index => $block ) {
		if ( 'text' === $block['type'] ) {
			$start = array_merge( $block, array( 'text' => '' ) );
			$delta = array(
				'type' => 'text_delta',
				'text' => $block['text'],
			);
		} else {
			$start = array_merge( $block, array( 'input' => (object) array() ) );
			$delta = array(
				'type'         => 'input_json_delta',
				'partial_json' => wp_json_encode( $block['input'] ?? (object) array() ),
			);
		}

		$events[] = array(
			'content_block_start',
			array(
				'type'          => 'content_block_start',
				'index'         => $index,
				'content_block' => $start,
			),
		);
		$events[] = array(
			'content_block_delta',
			array(
				'type'  => 'content_block_delta',
				'index' => $index,
				'delta' => $delta,
			),
		);
		$events[] = array(
			'content_block_stop',
			array(
				'type'  => 'content_block_stop',
				'index' => $index,
			),
		);
	}

	$events[] = array(
		'message_delta',
		array(
			'type'  => 'message_delta',
			'delta' => array( 'stop_reason' => $message['stop_reason'] ),
			'usage' => array( 'output_tokens' => $message['usage']['output_tokens'] ?? 0 ),
		),
	);
	$events[] = array( 'message_stop', array( 'type' => 'message_stop' ) );

	$output = '';

	foreach ( $events as list( $name, $data ) ) {
		$output .= "event: {$name}\ndata: " . wp_json_encode( $data ) . "\n\n";
	}

	return $output;
}

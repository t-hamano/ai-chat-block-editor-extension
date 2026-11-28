<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

/**
 * Passes chat requests from the editor on to the AI provider, adding the
 * site's API key on the server.
 *
 * The request body is built by the editor. Only the fields the editor sends
 * are passed on, with the editor's own tools and a fixed token limit, so the
 * key cannot be used for other features of the provider. Requests only go to
 * the fixed address of each provider and do not follow redirects, so the key
 * cannot be sent anywhere else.
 */
class Relay {

	/**
	 * How long to wait for the provider, in seconds
	 */
	const TIMEOUT = 300;

	/**
	 * The most tokens one answer may use, including the model's thinking
	 */
	const MAX_TOKENS = 64000;

	/**
	 * Constructor
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Registers the chat route
	 */
	public function register_routes() {
		register_rest_route(
			BLOCKTUNE_NAMESPACE . '/v1',
			'/chat',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'chat' ),
				'permission_callback' => array( Enqueue::class, 'can_use' ),
				'args'                => array(
					'provider' => array(
						'type'     => 'string',
						'enum'     => Providers::ids(),
						'required' => true,
					),
					'body'     => array(
						'type'     => 'object',
						'required' => true,
					),
					'stream'   => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
	}

	/**
	 * Sends the request to the provider and returns its answer
	 *
	 * With `stream`, the answer is passed on as it arrives. Otherwise it comes
	 * back whole, for servers that hold streamed answers back.
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function chat( WP_REST_Request $request ) {
		$provider_id = $request->get_param( 'provider' );

		$api_key = Api_Key::get( $provider_id );

		if ( '' === $api_key ) {
			return new WP_Error(
				'blocktune_no_api_key',
				__( 'No API key is set for this provider.', 'blocktune' ),
				array( 'status' => 400 )
			);
		}

		// Sites can turn AI off, or stop prompts, as they do for the AI Client.
		// When AI is off, the filter is not applied, as in the AI Client.
		if ( ! wp_supports_ai() ) {
			return new WP_Error(
				'blocktune_prompt_prevented',
				__( 'AI features are not supported in this environment.', 'blocktune' ),
				array( 'status' => 503 )
			);
		}

		// The hook is the AI Client's own, so it is not prefixed.
		if ( apply_filters( 'wp_ai_client_prevent_prompt', false, wp_ai_client_prompt()->using_provider( $provider_id ) ) ) { // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
			return new WP_Error(
				'blocktune_prompt_prevented',
				__( 'Prompt execution was prevented by a filter.', 'blocktune' ),
				array( 'status' => 503 )
			);
		}

		$provider = Providers::LIST[ $provider_id ];
		$body     = self::check_body( $provider_id, $request->get_param( 'body' ) );

		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$stream  = (bool) $request->get_param( 'stream' );
		$headers = array_merge(
			$provider['headers'],
			array(
				'content-type'   => 'application/json',
				$provider['key'] => ( $provider['key_prefix'] ?? '' ) . $api_key,
			)
		);

		$url = $stream && isset( $provider['stream_url'] ) ? $provider['stream_url'] : $provider['url'];

		if ( isset( $provider['stream_url'] ) ) {
			unset( $body['stream'] );
		} else {
			$body['stream'] = $stream;
		}

		if ( str_contains( $url, '{model}' ) ) {
			$model = $body['model'] ?? null;

			// The model is part of the address, so it must not change where the request goes.
			if ( ! is_string( $model ) || ! preg_match( '/^[a-z0-9][a-z0-9._-]*$/i', $model ) ) {
				return new WP_Error(
					'blocktune_invalid_model',
					__( 'The model is not valid.', 'blocktune' ),
					array( 'status' => 400 )
				);
			}

			unset( $body['model'] );
			$url = str_replace( '{model}', $model, $url );
		}

		if ( $stream ) {
			$error = ( new Stream() )->send( $url, $headers, wp_json_encode( $body ) );

			if ( $error ) {
				return $error;
			}

			// The answer has been sent, so WordPress must not send a response of its own.
			exit;
		}

		$response = wp_remote_post(
			$url,
			array(
				'headers'     => $headers,
				'body'        => wp_json_encode( $body ),
				'timeout'     => self::TIMEOUT,
				'redirection' => 0,
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'blocktune_provider_unreachable',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		return new WP_REST_Response(
			json_decode( wp_remote_retrieve_body( $response ), true ),
			wp_remote_retrieve_response_code( $response )
		);
	}

	/**
	 * Checks that the body only asks for what the editor sends
	 *
	 * The editor sends the fields listed for the provider, and only its own
	 * function tools. The token limit is set here, whatever the body asks for.
	 *
	 * @param string $provider_id The provider ID.
	 * @param array  $body        The request body.
	 * @return array|WP_Error The body to send, or an error.
	 */
	private static function check_body( string $provider_id, array $body ) {
		$provider = Providers::LIST[ $provider_id ];

		// The relay sets or takes out `stream` itself.
		unset( $body['stream'] );

		if ( ! self::has_only( $body, $provider['body'] ) ) {
			return new WP_Error(
				'blocktune_invalid_body',
				__( 'The request asks for something the assistant does not use.', 'blocktune' ),
				array( 'status' => 400 )
			);
		}

		list( $field, $inner ) = array_pad( $provider['max_tokens'], 2, null );

		if ( $inner ) {
			$body[ $field ][ $inner ] = self::MAX_TOKENS;
		} else {
			$body[ $field ] = self::MAX_TOKENS;
		}

		return $body;
	}

	/**
	 * Whether the data only has the listed fields
	 *
	 * @param mixed $data   The data.
	 * @param array $fields The fields, as described for `body` in Providers::LIST.
	 * @return bool
	 */
	private static function has_only( $data, array $fields ) {
		if ( ! is_array( $data ) ) {
			return false;
		}

		// A list in a list describes each item of a list.
		if ( array( 0 ) === array_keys( $fields ) && is_array( $fields[0] ) ) {
			if ( ! array_is_list( $data ) ) {
				return false;
			}

			foreach ( $data as $item ) {
				if ( ! self::has_only( $item, $fields[0] ) ) {
					return false;
				}
			}

			return true;
		}

		foreach ( $data as $key => $value ) {
			if ( is_string( $key ) && array_key_exists( $key, $fields ) ) {
				$rule = $fields[ $key ];

				if ( is_array( $rule ) ? ! self::has_only( $value, $rule ) : $rule !== $value ) {
					return false;
				}
			} elseif ( ! in_array( $key, $fields, true ) ) {
				return false;
			}
		}

		return true;
	}
}

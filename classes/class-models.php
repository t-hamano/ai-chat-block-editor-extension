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
 * Lists the models a provider offers, from the provider's Models API.
 *
 * The list is kept for a while, so that opening the editor does not ask the
 * provider every time. It is fetched with the site's API key, which never
 * leaves the server.
 */
class Models {

	/**
	 * How long the list is kept, in seconds
	 */
	const CACHE_TIME = 12 * HOUR_IN_SECONDS;

	/**
	 * How long to wait for the provider, in seconds
	 */
	const TIMEOUT = 15;

	/**
	 * Constructor
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Registers the models route
	 */
	public function register_routes() {
		register_rest_route(
			BLOCKTUNE_NAMESPACE . '/v1',
			'/models',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'list_models' ),
				'permission_callback' => array( Enqueue::class, 'can_use' ),
				'args'                => array(
					'provider' => array(
						'type'     => 'string',
						'enum'     => array_keys( Relay::PROVIDERS ),
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Returns the models of the provider
	 *
	 * @param WP_REST_Request $request The request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function list_models( WP_REST_Request $request ) {
		$models = self::get( $request->get_param( 'provider' ) );

		if ( is_wp_error( $models ) ) {
			return $models;
		}

		return new WP_REST_Response( $models );
	}

	/**
	 * Gets the models of a provider, from the cache when it has them
	 *
	 * @param string $provider_id The provider ID, such as `anthropic`.
	 * @return array|WP_Error The models, each with an `id` and a `name`.
	 */
	public static function get( string $provider_id ) {
		$api_key = Api_Key::get( $provider_id );

		if ( '' === $api_key ) {
			return new WP_Error(
				'blocktune_no_api_key',
				__( 'No API key is set for this provider.', 'blocktune' ),
				array( 'status' => 400 )
			);
		}

		// The key is part of the name, so a new key gets its own list.
		$cache_key = BLOCKTUNE_NAMESPACE . '_models_' . wp_hash( $provider_id . $api_key );
		$models    = get_transient( $cache_key );

		if ( is_array( $models ) ) {
			return $models;
		}

		$models = self::fetch( $provider_id, $api_key );

		// Errors are not kept, so the next request tries again.
		if ( ! is_wp_error( $models ) ) {
			set_transient( $cache_key, $models, self::CACHE_TIME );
		}

		return $models;
	}

	/**
	 * Asks the provider for its models
	 *
	 * @param string $provider_id The provider ID.
	 * @param string $api_key     The provider's API key.
	 * @return array|WP_Error The models, each with an `id` and a `name`.
	 */
	private static function fetch( string $provider_id, string $api_key ) {
		$provider = Relay::PROVIDERS[ $provider_id ];

		$response = wp_remote_get(
			$provider['models'],
			array(
				'headers'     => array_merge( $provider['headers'], array( $provider['key'] => ( $provider['key_prefix'] ?? '' ) . $api_key ) ),
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

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		// Google lists its models under `models`, and the others under `data`.
		$list = $body['data'] ?? $body['models'] ?? null;

		if ( 200 !== wp_remote_retrieve_response_code( $response ) || ! is_array( $list ) ) {
			return new WP_Error(
				'blocktune_models_unavailable',
				__( 'The provider did not return its models.', 'blocktune' ),
				array( 'status' => 502 )
			);
		}

		$models = array();

		foreach ( $list as $model ) {
			$model = self::normalize( $model );

			if ( $model ) {
				$models[] = $model;
			}
		}

		return $models;
	}

	/**
	 * Reads a model from a provider's list
	 *
	 * Google names its models `models/{id}`, with a `displayName`, and lists
	 * models that cannot chat, such as embedding models, which are left out.
	 *
	 * @param mixed $model The model, as the provider lists it.
	 * @return array|null The model with an `id` and a `name`, or null to leave it out.
	 */
	private static function normalize( $model ) {
		if ( ! is_array( $model ) ) {
			return null;
		}

		if ( isset( $model['id'] ) ) {
			$id   = $model['id'];
			$name = $model['display_name'] ?? null;
		} else {
			$id   = isset( $model['name'] ) && is_string( $model['name'] ) ? preg_replace( '#^models/#', '', $model['name'] ) : null;
			$name = $model['displayName'] ?? null;

			if ( isset( $model['supportedGenerationMethods'] ) && ! in_array( 'generateContent', (array) $model['supportedGenerationMethods'], true ) ) {
				return null;
			}
		}

		if ( empty( $id ) || ! is_string( $id ) ) {
			return null;
		}

		return array(
			'id'   => $id,
			'name' => is_string( $name ) && '' !== $name ? $name : $id,
		);
	}
}

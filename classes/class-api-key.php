<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

use WordPress\AiClient\AiClient;
use WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication;

/**
 * Reads the API keys that the site registered in Connectors.
 *
 * The keys are read from the AI Client, which gets them from Connectors in
 * the same order as Connectors: environment variable, then constant, then
 * the setting saved on the Connectors screen. A provider only has a key here
 * while its provider plugin is active.
 *
 * Keys never leave the server.
 */
class Api_Key {

	/**
	 * Gets the API key of a provider
	 *
	 * @param string $provider_id The provider ID, such as `anthropic`.
	 * @return string The key, or an empty string when the provider has none.
	 */
	public static function get( string $provider_id ): string {
		$registry = AiClient::defaultRegistry();

		if ( ! $registry->hasProvider( $provider_id ) ) {
			return '';
		}

		$authentication = $registry->getProviderRequestAuthentication( $provider_id );

		return $authentication instanceof ApiKeyRequestAuthentication ? $authentication->getApiKey() : '';
	}

	/**
	 * Whether any provider has an API key
	 *
	 * @return bool
	 */
	public static function has_any(): bool {
		foreach ( AiClient::defaultRegistry()->getRegisteredProviderIds() as $provider_id ) {
			if ( '' !== self::get( $provider_id ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Lists the providers the plugin streams from that have an API key
	 *
	 * @return string[] The provider IDs, such as `anthropic`.
	 */
	public static function connected_providers(): array {
		return array_values(
			array_filter(
				array_keys( Relay::PROVIDERS ),
				static function ( $provider_id ) {
					return '' !== self::get( $provider_id );
				}
			)
		);
	}
}

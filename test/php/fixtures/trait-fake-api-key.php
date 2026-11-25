<?php
/**
 * @package Blocktune
 */

use WordPress\AiClient\AiClient;
use WordPress\AiClient\Providers\Http\DTO\ApiKeyRequestAuthentication;

/**
 * Gives the AI Client an API key for a fake provider, and takes it away
 * after each test.
 */
trait Blocktune_Fake_Api_Key {

	/**
	 * Sets the API key of a fake provider.
	 *
	 * @param string $key      The key. An empty string means no key.
	 * @param string $provider The fake provider's class. The Anthropic one by default.
	 */
	protected function set_fake_api_key( string $key, string $provider = Blocktune_Fake_Provider::class ) {
		$registry = AiClient::defaultRegistry();

		if ( ! $registry->hasProvider( $provider::ID ) ) {
			$registry->registerProvider( $provider );
		}

		$registry->setProviderRequestAuthentication( $provider::ID, new ApiKeyRequestAuthentication( $key ) );
	}

	/**
	 * Removes the keys.
	 */
	public function tear_down() {
		$registry = AiClient::defaultRegistry();

		foreach ( array( Blocktune_Fake_Provider::class, Blocktune_Fake_OpenAI_Provider::class, Blocktune_Fake_Google_Provider::class ) as $provider ) {
			if ( $registry->hasProvider( $provider::ID ) ) {
				$this->set_fake_api_key( '', $provider );
			}
		}

		parent::tear_down();
	}
}

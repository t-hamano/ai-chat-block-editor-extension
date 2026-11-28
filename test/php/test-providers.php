<?php
/**
 * @package Blocktune
 */

use Blocktune\Providers;

/**
 * Tests for the Providers class.
 */
class Test_Providers extends WP_UnitTestCase {

	/**
	 * The IDs are the keys of the list, in order.
	 */
	public function test_ids() {
		$this->assertSame( array( 'anthropic', 'openai', 'google' ), Providers::ids() );
	}

	/**
	 * Each provider has what the relay and the models list need.
	 */
	public function test_each_provider_has_required_fields() {
		foreach ( Providers::LIST as $provider ) {
			foreach ( array( 'url', 'models', 'headers', 'key', 'body', 'max_tokens' ) as $field ) {
				$this->assertArrayHasKey( $field, $provider );
			}

			$this->assertStringStartsWith( 'https://', $provider['url'] );
			$this->assertStringStartsWith( 'https://', $provider['models'] );
		}
	}
}

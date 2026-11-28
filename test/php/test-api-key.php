<?php
/**
 * @package Blocktune
 */

use Blocktune\Api_Key;

/**
 * Tests for the Api_Key class.
 */
class Test_Api_Key extends WP_UnitTestCase {

	use Blocktune_Fake_Api_Key;

	/**
	 * Tests that a provider that is not registered has no key.
	 */
	public function test_unregistered_provider_has_no_key() {
		$this->assertSame( '', Api_Key::get_provider_api_key( 'blocktune-unregistered' ) );
	}

	/**
	 * Tests that the key given to the AI Client is returned.
	 */
	public function test_get_returns_the_key() {
		$this->set_fake_api_key( 'test-key' );

		$this->assertSame( 'test-key', Api_Key::get_provider_api_key( Blocktune_Fake_Provider::ID ) );
	}

	/**
	 * Tests that a registered provider without a key has no key.
	 */
	public function test_get_returns_empty_string_without_key() {
		$this->set_fake_api_key( '' );

		$this->assertSame( '', Api_Key::get_provider_api_key( Blocktune_Fake_Provider::ID ) );
	}

	/**
	 * Tests that a key is found when a provider has one.
	 */
	public function test_has_any_with_key() {
		$this->set_fake_api_key( 'test-key' );

		$this->assertTrue( Api_Key::has_any_provider_api_key() );
	}

	/**
	 * Tests that no key is found when no provider has one.
	 */
	public function test_has_any_without_key() {
		$this->set_fake_api_key( '' );

		$this->assertFalse( Api_Key::has_any_provider_api_key() );
	}
}

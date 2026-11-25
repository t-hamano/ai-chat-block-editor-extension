<?php
/**
 * @package Blocktune
 */

/**
 * Tests for the main plugin file.
 */
class Test_Plugin extends WP_UnitTestCase {

	/**
	 * Tests that the plugin constants are defined.
	 */
	public function test_constants_are_defined() {
		$this->assertSame( 'blocktune', BLOCKTUNE_NAMESPACE );
		$this->assertSame( untrailingslashit( dirname( __DIR__, 2 ) ), BLOCKTUNE_PATH );
		$this->assertStringEndsWith( '/blocktune', BLOCKTUNE_URL );
	}
}

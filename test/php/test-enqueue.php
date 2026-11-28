<?php
/**
 * @package Blocktune
 */

use Blocktune\Enqueue;

/**
 * Tests for the Enqueue class.
 */
class Test_Enqueue extends WP_UnitTestCase {

	use Blocktune_Fake_Api_Key;

	/**
	 * Removes the script and style enqueued by a test.
	 */
	public function tear_down() {
		$this->set_fake_api_key( '' );
		wp_dequeue_script( BLOCKTUNE_NAMESPACE );
		wp_deregister_script( BLOCKTUNE_NAMESPACE );
		wp_dequeue_style( BLOCKTUNE_NAMESPACE );
		wp_deregister_style( BLOCKTUNE_NAMESPACE );

		parent::tear_down();
	}

	/**
	 * Tests that the script and style are not enqueued for editors.
	 */
	public function test_script_is_not_enqueued_for_editor() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		( new Enqueue() )->enqueue_editor_scripts();

		$this->assertFalse( wp_script_is( BLOCKTUNE_NAMESPACE ) );
		$this->assertFalse( wp_style_is( BLOCKTUNE_NAMESPACE ) );
	}

	/**
	 * Tests that the script and style are enqueued for administrators.
	 */
	public function test_script_is_enqueued_for_administrator() {
		if ( ! file_exists( BLOCKTUNE_PATH . '/build/index.asset.php' ) ) {
			$this->markTestSkipped( 'The script is only enqueued when the plugin is built.' );
		}

		$this->set_fake_api_key( 'test-key' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		( new Enqueue() )->enqueue_editor_scripts();

		$this->assertTrue( wp_script_is( BLOCKTUNE_NAMESPACE ) );
		$this->assertTrue( wp_style_is( BLOCKTUNE_NAMESPACE ) );
		$this->assertStringContainsString(
			'"aiSupported":true',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
		$this->assertStringContainsString(
			'"hasApiKey":true',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
		$this->assertStringContainsString(
			'"providers":["anthropic"]',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
	}

	/**
	 * Tests that the script and style are enqueued without an API key, so the
	 * sidebar can link to the Connectors screen.
	 */
	public function test_script_is_enqueued_without_api_key() {
		if ( ! file_exists( BLOCKTUNE_PATH . '/build/index.asset.php' ) ) {
			$this->markTestSkipped( 'The script is only enqueued when the plugin is built.' );
		}

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

		( new Enqueue() )->enqueue_editor_scripts();

		$this->assertTrue( wp_script_is( BLOCKTUNE_NAMESPACE ) );
		$this->assertStringContainsString(
			'"hasApiKey":false',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
		$this->assertStringContainsString(
			'"providers":[]',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
	}

	/**
	 * Tests that the script tells the sidebar when the site does not support AI,
	 * so it can show a notice instead of the chat.
	 */
	public function test_script_reports_when_ai_is_not_supported() {
		if ( ! file_exists( BLOCKTUNE_PATH . '/build/index.asset.php' ) ) {
			$this->markTestSkipped( 'The script is only enqueued when the plugin is built.' );
		}

		$this->set_fake_api_key( 'test-key' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		add_filter( 'wp_supports_ai', '__return_false' );

		( new Enqueue() )->enqueue_editor_scripts();

		$this->assertTrue( wp_script_is( BLOCKTUNE_NAMESPACE ) );
		$this->assertStringContainsString(
			'"aiSupported":false',
			implode( '', wp_scripts()->get_data( BLOCKTUNE_NAMESPACE, 'before' ) )
		);
	}
}

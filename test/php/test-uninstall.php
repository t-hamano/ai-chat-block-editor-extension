<?php
/**
 * @package AI_Chat_Block_Editor_Extension
 */

/**
 * Tests for uninstall.php.
 */
class Test_Uninstall extends WP_UnitTestCase {

	/**
	 * Runs uninstall.php.
	 */
	private function uninstall() {
		if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
			define( 'WP_UNINSTALL_PLUGIN', 'ai-chat-block-editor-extension/ai-chat-block-editor-extension.php' );
		}

		if ( function_exists( 'ai_chat_block_editor_extension_uninstall_site' ) ) {
			ai_chat_block_editor_extension_uninstall_site();
		} else {
			require dirname( __DIR__, 2 ) . '/uninstall.php';
		}
	}

	/**
	 * Tests that only the plugin's scope of the preferences is removed.
	 */
	public function test_removes_only_the_plugin_preferences() {
		global $wpdb;

		$meta_key = $wpdb->get_blog_prefix() . 'persisted_preferences';
		$user_id  = self::factory()->user->create();

		update_user_meta(
			$user_id,
			$meta_key,
			wp_slash(
				array(
					'core'                           => array( 'fixedToolbar' => true ),
					'other-plugin'                   => array( 'pattern' => '\\d+' ),
					'ai-chat-block-editor-extension' => array( 'model' => 'anthropic/claude' ),
					'_modified'                      => '2026-11-15T00:00:00.000Z',
				)
			)
		);

		$this->uninstall();

		$this->assertSame(
			array(
				'core'         => array( 'fixedToolbar' => true ),
				'other-plugin' => array( 'pattern' => '\\d+' ),
				'_modified'    => '2026-11-15T00:00:00.000Z',
			),
			get_user_meta( $user_id, $meta_key, true )
		);
	}

	/**
	 * Tests that the meta is removed when nothing else is left in it.
	 */
	public function test_removes_empty_preferences() {
		global $wpdb;

		$meta_key = $wpdb->get_blog_prefix() . 'persisted_preferences';
		$user_id  = self::factory()->user->create();

		update_user_meta(
			$user_id,
			$meta_key,
			array(
				'ai-chat-block-editor-extension' => array( 'model' => 'anthropic/claude' ),
				'_modified'                      => '2026-11-15T00:00:00.000Z',
			)
		);

		$this->uninstall();

		$this->assertSame( array(), get_user_meta( $user_id, $meta_key ) );
	}
}

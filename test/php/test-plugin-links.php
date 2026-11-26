<?php
/**
 * @package Blocktune
 */

use Blocktune\Plugin_Links;

/**
 * Tests for the Plugin_Links class.
 */
class Test_Plugin_Links extends WP_UnitTestCase {

	/**
	 * Tests that the Connectors link is added before the other links.
	 */
	public function test_connectors_link_is_added_first() {
		$links = ( new Plugin_Links() )->add_action_links( array( 'deactivate' => '<a href="#">Deactivate</a>' ) );

		$this->assertCount( 2, $links );
		$this->assertSame(
			'<a href="' . esc_url( admin_url( 'options-connectors.php' ) ) . '">Connectors</a>',
			$links[0]
		);
		$this->assertSame( '<a href="#">Deactivate</a>', $links['deactivate'] );
	}

	/**
	 * Tests that the links are added to the plugin's own row.
	 */
	public function test_filter_is_registered_for_plugin() {
		$plugin_links = new Plugin_Links();

		$this->assertSame(
			10,
			has_filter( 'plugin_action_links_' . plugin_basename( BLOCKTUNE_PATH . '/blocktune.php' ), array( $plugin_links, 'add_action_links' ) )
		);
	}
}

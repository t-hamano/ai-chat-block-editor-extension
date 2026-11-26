<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

/**
 * Adds links to the plugin's row on the Plugins screen.
 */
class Plugin_Links {

	/**
	 * Constructor
	 */
	public function __construct() {
		add_filter( 'plugin_action_links_' . plugin_basename( BLOCKTUNE_PATH . '/blocktune.php' ), array( $this, 'add_action_links' ) );
	}

	/**
	 * Adds a link to the Connectors screen, where the API keys are set
	 *
	 * @param array<string> $links The plugin's action links.
	 * @return array<string> The action links with the Connectors link first.
	 */
	public function add_action_links( array $links ): array {
		$connectors_link = sprintf(
			'<a href="%1$s">%2$s</a>',
			esc_url( admin_url( 'options-connectors.php' ) ),
			esc_html__( 'Connectors', 'blocktune' )
		);

		array_unshift( $links, $connectors_link );

		return $links;
	}
}

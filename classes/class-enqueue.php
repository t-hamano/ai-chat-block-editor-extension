<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

class Enqueue {

	/**
	 * Constructor
	 */
	public function __construct() {
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_editor_scripts' ) );
		add_action( 'enqueue_block_assets', array( $this, 'enqueue_canvas_styles' ) );
	}

	/**
	 * Whether the current user can use the AI assistant
	 *
	 * Only administrators can use it, because requests are sent with the site's
	 * API keys. On a multisite network the keys can be shared by every site, so
	 * only super admins can use it there.
	 *
	 * @return bool
	 */
	public static function can_use_assistant() {
		return current_user_can( is_multisite() ? 'manage_network_options' : 'manage_options' );
	}

	/**
	 * Enqueue block editor scripts
	 */
	public function enqueue_editor_scripts() {
		if ( ! self::can_use_assistant() ) {
			return;
		}

		// The widgets editor and the customizer have no editor sidebar.
		if ( wp_script_is( 'wp-edit-widgets' ) || wp_script_is( 'wp-customize-widgets' ) ) {
			return;
		}

		$asset_path = BLOCKTUNE_PATH . '/build/index.asset.php';

		if ( ! file_exists( $asset_path ) ) {
			return;
		}

		$asset_file = include $asset_path;

		wp_enqueue_script(
			BLOCKTUNE_NAMESPACE,
			BLOCKTUNE_URL . '/build/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			array( 'in_footer' => true )
		);

		wp_add_inline_script(
			BLOCKTUNE_NAMESPACE,
			sprintf(
				'window.blocktune = %s;',
				wp_json_encode(
					array(
						'isAiSupported' => wp_supports_ai(),
						'hasApiKey'     => Api_Key::has_any_provider_api_key(),
						'providers'     => Api_Key::get_connected_providers(),
						'connectorsUrl' => admin_url( 'options-connectors.php' ),
					)
				)
			),
			'before'
		);

		wp_set_script_translations( BLOCKTUNE_NAMESPACE, BLOCKTUNE_NAMESPACE );

		wp_enqueue_style(
			BLOCKTUNE_NAMESPACE,
			BLOCKTUNE_URL . '/build/style-index.css',
			array(),
			$asset_file['version']
		);
		wp_style_add_data( BLOCKTUNE_NAMESPACE, 'rtl', 'replace' );
	}

	/**
	 * Enqueue the styles for the blocks in the editor canvas
	 *
	 * They are loaded on `enqueue_block_assets` so that they reach the canvas
	 * iframe. That hook also runs on the front end, where they are not needed.
	 */
	public function enqueue_canvas_styles() {
		if ( ! is_admin() || ! self::can_use_assistant() || ! wp_supports_ai() || ! Api_Key::has_any_provider_api_key() ) {
			return;
		}

		$asset_path = BLOCKTUNE_PATH . '/build/index.asset.php';

		if ( ! file_exists( $asset_path ) || ! file_exists( BLOCKTUNE_PATH . '/build/index.css' ) ) {
			return;
		}

		$asset_file = include $asset_path;
		$handle     = BLOCKTUNE_NAMESPACE . '-canvas';

		wp_enqueue_style(
			$handle,
			BLOCKTUNE_URL . '/build/index.css',
			array(),
			$asset_file['version']
		);
		wp_style_add_data( $handle, 'rtl', 'replace' );
	}
}

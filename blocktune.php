<?php
/**
 * Plugin Name: Blocktune – AI Block Editing Chat
 * Description: Select blocks or text in the block editor and edit them by chatting with AI.
 * Requires at least: 7.1
 * Requires PHP: 8.3
 * Version: 0.1.0
 * Author: Aki Hamano
 * Author URI: https://github.com/t-hamano
 * License: GPL2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: blocktune
 *
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

defined( 'ABSPATH' ) || exit;

define( 'BLOCKTUNE_NAMESPACE', 'blocktune' );
define( 'BLOCKTUNE_PATH', untrailingslashit( plugin_dir_path( __FILE__ ) ) );
define( 'BLOCKTUNE_URL', untrailingslashit( plugin_dir_url( __FILE__ ) ) );

require_once __DIR__ . '/classes/class-api-key.php';
require_once __DIR__ . '/classes/class-enqueue.php';
require_once __DIR__ . '/classes/class-fallback.php';
require_once __DIR__ . '/classes/class-models.php';
require_once __DIR__ . '/classes/class-plugin-links.php';
require_once __DIR__ . '/classes/class-relay.php';
require_once __DIR__ . '/classes/class-stream.php';

new Blocktune\Enqueue();
new Blocktune\Fallback();
new Blocktune\Models();
new Blocktune\Plugin_Links();
new Blocktune\Relay();

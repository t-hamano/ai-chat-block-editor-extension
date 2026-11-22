<?php
/**
 * Plugin Name: AI Chat Block Editor Extension
 * Description: Select blocks or text in the block editor and edit them by chatting with AI.
 * Requires at least: 7.1
 * Requires PHP: 8.3
 * Version: 0.1.0
 * Author: Aki Hamano
 * Author URI: https://github.com/t-hamano
 * License: GPL2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: ai-chat-block-editor-extension
 *
 * @package AI_Chat_Block_Editor_Extension
 * @author Aki Hamano
 * @license GPL-2.0+
 */

defined( 'ABSPATH' ) || exit;

define( 'AI_CHAT_BLOCK_EDITOR_EXTENSION_NAMESPACE', 'ai-chat-block-editor-extension' );
define( 'AI_CHAT_BLOCK_EDITOR_EXTENSION_PATH', untrailingslashit( plugin_dir_path( __FILE__ ) ) );
define( 'AI_CHAT_BLOCK_EDITOR_EXTENSION_URL', untrailingslashit( plugin_dir_url( __FILE__ ) ) );

require_once __DIR__ . '/classes/class-api-key.php';
require_once __DIR__ . '/classes/class-enqueue.php';
require_once __DIR__ . '/classes/class-fallback.php';
require_once __DIR__ . '/classes/class-models.php';
require_once __DIR__ . '/classes/class-relay.php';
require_once __DIR__ . '/classes/class-stream.php';

new AI_Chat_Block_Editor_Extension\Enqueue();
new AI_Chat_Block_Editor_Extension\Fallback();
new AI_Chat_Block_Editor_Extension\Models();
new AI_Chat_Block_Editor_Extension\Relay();

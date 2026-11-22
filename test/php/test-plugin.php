<?php
/**
 * @package AI_Chat_Block_Editor_Extension
 */

/**
 * Tests for the main plugin file.
 */
class Test_Plugin extends WP_UnitTestCase {

	/**
	 * Tests that the plugin constants are defined.
	 */
	public function test_constants_are_defined() {
		$this->assertSame( 'ai-chat-block-editor-extension', AI_CHAT_BLOCK_EDITOR_EXTENSION_NAMESPACE );
		$this->assertSame( untrailingslashit( dirname( __DIR__, 2 ) ), AI_CHAT_BLOCK_EDITOR_EXTENSION_PATH );
		$this->assertStringEndsWith( '/ai-chat-block-editor-extension', AI_CHAT_BLOCK_EDITOR_EXTENSION_URL );
	}
}

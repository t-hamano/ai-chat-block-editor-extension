<?php
/**
 * Removes the data the plugin stored, when the plugin is deleted.
 *
 * @package AI_Chat_Block_Editor_Extension
 * @author Aki Hamano
 * @license GPL-2.0+
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Removes the data the plugin stored on the current site.
 *
 * Each user's model choice is kept in the `ai-chat-block-editor-extension`
 * scope of the `persisted_preferences` user meta. That meta also holds the
 * preferences of WordPress itself and of other plugins, so only this scope
 * is removed.
 *
 * The cached model lists are transients that expire within 12 hours, and
 * WordPress deletes expired transients on its own, so they are left alone.
 */
function ai_chat_block_editor_extension_uninstall_site() {
	global $wpdb;

	$scope    = 'ai-chat-block-editor-extension';
	$meta_key = $wpdb->get_blog_prefix() . 'persisted_preferences';
	$user_ids = get_users(
		array(
			'blog_id'  => 0,
			'meta_key' => $meta_key, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'fields'   => 'ID',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$preferences = get_user_meta( (int) $user_id, $meta_key, true );

		if ( ! is_array( $preferences ) || ! array_key_exists( $scope, $preferences ) ) {
			continue;
		}

		unset( $preferences[ $scope ] );

		// `_modified` is only the time of the last change, not a preference.
		if ( array() === array_diff_key( $preferences, array( '_modified' => true ) ) ) {
			delete_user_meta( (int) $user_id, $meta_key );
		} else {
			// The meta functions remove slashes, so they are added back first.
			update_user_meta( (int) $user_id, $meta_key, wp_slash( $preferences ) );
		}
	}
}

if ( is_multisite() ) {
	$ai_chat_block_editor_extension_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);

	foreach ( $ai_chat_block_editor_extension_site_ids as $ai_chat_block_editor_extension_site_id ) {
		switch_to_blog( $ai_chat_block_editor_extension_site_id );
		ai_chat_block_editor_extension_uninstall_site();
		restore_current_blog();
	}
} else {
	ai_chat_block_editor_extension_uninstall_site();
}

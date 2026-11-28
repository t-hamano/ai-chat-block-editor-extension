<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

/**
 * The AI providers the plugin talks to directly, and how to talk to each.
 */
class Providers {

	// The AI Client returns the whole answer at once, so the relay talks to
	// these providers directly to stream the answer to the editor as it is
	// written. Other providers go through the AI Client in Fallback.
	// phpcs:disable PluginCheck.CodeAnalysis.AIProvider.DirectIntegration

	/**
	 * Where each provider's requests go, and the headers that carry the key
	 *
	 * `url` takes chat requests, and `models` lists the provider's models.
	 * `key_prefix` goes before the key in its header, such as `Bearer `.
	 * A provider with `stream_url` takes streamed requests there instead of
	 * with `stream` in the body. `{model}` in either address is replaced with
	 * the body's `model`, which is then taken out of the body.
	 *
	 * `body` lists the fields of the body that are passed on. A field with a
	 * list of its own only passes on those inner fields, a field with a list
	 * in a list is a list whose items only have those fields, and a field
	 * with a value must have that value. Only the editor's own function tools
	 * fit, so tools that run on the provider's side, such as web search, are
	 * not passed on. `max_tokens` is the path to the field that limits the
	 * answer's tokens.
	 */
	const LIST = array(
		'anthropic' => array(
			'url'        => 'https://api.anthropic.com/v1/messages',
			'models'     => 'https://api.anthropic.com/v1/models?limit=1000',
			'headers'    => array(
				'anthropic-version' => '2023-06-01',
			),
			'key'        => 'x-api-key',
			'body'       => array(
				'model',
				'max_tokens',
				'cache_control',
				'system',
				'tools'         => array( array( 'name', 'description', 'eager_input_streaming', 'input_schema' ) ),
				'messages',
				'output_config' => array( 'effort' ),
			),
			'max_tokens' => array( 'max_tokens' ),
		),
		'openai'    => array(
			'url'        => 'https://api.openai.com/v1/responses',
			'models'     => 'https://api.openai.com/v1/models',
			'headers'    => array(),
			'key'        => 'authorization',
			'key_prefix' => 'Bearer ',
			'body'       => array(
				'model',
				'max_output_tokens',
				'instructions',
				'tools'     => array(
					array(
						'type' => 'function',
						'name',
						'description',
						'parameters',
						'strict',
					),
				),
				'input',
				'store',
				'include',
				'reasoning' => array( 'effort' ),
			),
			'max_tokens' => array( 'max_output_tokens' ),
		),
		'google'    => array(
			'url'        => 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
			'stream_url' => 'https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse',
			'models'     => 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
			'headers'    => array(),
			'key'        => 'x-goog-api-key',
			'body'       => array(
				'model',
				'systemInstruction',
				'contents',
				'tools'            => array(
					array(
						'functionDeclarations' => array( array( 'name', 'description', 'parameters' ) ),
					),
				),
				'generationConfig' => array( 'maxOutputTokens', 'thinkingConfig' ),
			),
			'max_tokens' => array( 'generationConfig', 'maxOutputTokens' ),
		),
	);
	// phpcs:enable PluginCheck.CodeAnalysis.AIProvider.DirectIntegration

	/**
	 * Lists the provider IDs
	 *
	 * @return string[] The provider IDs, such as `anthropic`.
	 */
	public static function ids(): array {
		return array_keys( self::LIST );
	}
}

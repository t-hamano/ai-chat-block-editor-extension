<?php
/**
 * @package Blocktune
 * @author Aki Hamano
 * @license GPL-2.0+
 */

namespace Blocktune;

use WP_Error;

/**
 * Sends a request to the provider and passes its streamed answer (Server-Sent
 * Events) on to the browser as each piece arrives.
 *
 * The request is sent with `wp_remote_post()`, so it follows the site's proxy
 * and its rules for outgoing requests. `wp_remote_post()` waits for the whole
 * answer, so when it uses cURL, the `http_api_curl` hook makes cURL pass each
 * piece on as it arrives instead. Without cURL, the answer is passed on whole
 * when it has all arrived.
 */
class Stream {

	/**
	 * The event that tells the browser the provider's answer stopped partway
	 */
	const ERROR_EVENT = 'blocktune_error';

	/**
	 * The provider's HTTP status
	 *
	 * @var int
	 */
	protected $status = 0;

	/**
	 * The provider's content type
	 *
	 * @var string
	 */
	protected $content_type = '';

	/**
	 * Whether any of the answer has been sent to the browser
	 *
	 * @var bool
	 */
	private $started = false;

	/**
	 * The provider's address
	 *
	 * @var string
	 */
	private $url = '';

	/**
	 * The cURL handle of the request, when it is sent with cURL
	 *
	 * @var \CurlHandle|null
	 */
	private $handle = null;

	/**
	 * Sends the request and passes the answer on
	 *
	 * @param string $url     The provider's address.
	 * @param array  $headers The request headers, by name.
	 * @param string $body    The request body.
	 * @return WP_Error|null An error when nothing could be sent to the browser.
	 */
	public function send_and_stream_response( string $url, array $headers, string $body ) {
		// Hosts can turn off the functions below, and calling one then stops
		// PHP, so each is checked first.
		// Keep running when the user stops the answer, so the connection to
		// the provider is closed here instead of being cut off.
		if ( function_exists( 'ignore_user_abort' ) ) {
			ignore_user_abort( true );
		}
		// Only this request runs longer, as long as the provider may take.
		if ( function_exists( 'set_time_limit' ) ) {
			set_time_limit( Relay::TIMEOUT + 10 ); // phpcs:ignore Squiz.PHP.DiscouragedFunctions.Discouraged
		}

		$this->url = $url;

		add_action( 'http_api_curl', array( $this, 'attach_curl_callbacks' ), 10, 3 );

		$response = wp_remote_post(
			$url,
			array(
				'headers'     => $headers,
				'body'        => $body,
				'timeout'     => Relay::TIMEOUT,
				'redirection' => 0,
			)
		);

		remove_action( 'http_api_curl', array( $this, 'attach_curl_callbacks' ), 10 );

		if ( $this->started ) {
			if ( is_wp_error( $response ) && ! connection_aborted() ) {
				$this->send_error_event( $this->is_curl_timed_out() );
			}
			return null;
		}

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'blocktune_provider_unreachable',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		// The whole answer came at once, such as on a server without cURL.
		$this->status       = (int) wp_remote_retrieve_response_code( $response );
		$this->content_type = (string) wp_remote_retrieve_header( $response, 'content-type' );
		$this->output_chunk( wp_remote_retrieve_body( $response ) );

		return null;
	}

	/**
	 * Makes cURL pass the answer on as it arrives
	 *
	 * Only the handling of the body is replaced. WordPress still reads the
	 * headers itself.
	 *
	 * @param \CurlHandle $handle The cURL handle.
	 * @param array       $args   The request arguments.
	 * @param string      $url    The request address.
	 */
	public function attach_curl_callbacks( $handle, array $args, string $url ) {
		if ( $url !== $this->url ) {
			return;
		}

		$this->handle = $handle;

		// phpcs:disable WordPress.WP.AlternativeFunctions.curl_curl_setopt -- `http_api_curl` hands over the handle to change how the answer is read.
		curl_setopt( $handle, CURLOPT_WRITEFUNCTION, array( $this, 'write_chunk' ) );
		// Stopping from the write function would make WordPress send the
		// request again, so the progress function stops it instead.
		curl_setopt( $handle, CURLOPT_NOPROGRESS, false );
		curl_setopt( $handle, CURLOPT_XFERINFOFUNCTION, array( $this, 'abort_if_disconnected' ) );
		// phpcs:enable WordPress.WP.AlternativeFunctions.curl_curl_setopt
	}

	/**
	 * Passes a piece of the provider's answer on to the browser
	 *
	 * @param mixed  $handle The cURL handle.
	 * @param string $data   The piece.
	 * @return int The length of the piece, so that cURL goes on.
	 */
	public function write_chunk( $handle, string $data ): int {
		if ( ! $this->started ) {
			// phpcs:disable WordPress.WP.AlternativeFunctions.curl_curl_getinfo -- The handle comes from `http_api_curl`.
			$this->status       = (int) curl_getinfo( $handle, CURLINFO_RESPONSE_CODE );
			$this->content_type = (string) curl_getinfo( $handle, CURLINFO_CONTENT_TYPE );
			// phpcs:enable WordPress.WP.AlternativeFunctions.curl_curl_getinfo
		}

		$this->output_chunk( $data );

		return strlen( $data );
	}

	/**
	 * Whether cURL should go on, called by cURL while the answer arrives
	 *
	 * @return int 1 to stop when the browser has gone, or 0 to go on.
	 */
	public function abort_if_disconnected(): int {
		// The user stopped the answer, so stop the provider's answer too.
		return connection_aborted() ? 1 : 0;
	}

	/**
	 * Tells the browser that the provider's answer stopped partway, as an
	 * event of its own after what has arrived
	 *
	 * @param bool $timed_out Whether the provider took too long.
	 */
	public function send_error_event( bool $timed_out ) {
		$message = $timed_out
			? __( 'The provider took too long to answer, so the answer was stopped.', 'blocktune' )
			: __( 'The connection to the provider was lost before the answer was finished.', 'blocktune' );

		// The empty lines end an event the provider may have left unfinished.
		echo "\n\nevent: " . self::ERROR_EVENT . "\ndata: " . wp_json_encode( array( 'message' => $message ) ) . "\n\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		flush();
	}

	/**
	 * Sends a piece of the answer to the browser, after the headers when it
	 * is the first
	 *
	 * @param string $data The piece.
	 */
	private function output_chunk( string $data ) {
		if ( ! $this->started ) {
			$this->started = true;
			$this->start_stream_output();
		}

		echo $data; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		flush();
	}

	/**
	 * Whether the provider took too long
	 *
	 * @return bool
	 */
	private function is_curl_timed_out(): bool {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_errno -- The handle comes from `http_api_curl`.
		return $this->handle && CURLE_OPERATION_TIMEDOUT === curl_errno( $this->handle );
	}

	/**
	 * Sends the headers, and turns off everything that would hold the answer back
	 */
	protected function start_stream_output() {
		while ( ob_get_level() > 0 ) {
			ob_end_clean();
		}

		// Apache's gzip compression (mod_deflate) collects output before
		// sending it, so turn it off for this request. The function only
		// exists when PHP runs as an Apache module.
		if ( function_exists( 'apache_setenv' ) ) {
			apache_setenv( 'no-gzip', '1' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_apache_setenv -- Needed to stream the response.
		}
		// PHP's own compression holds output back in the same way.
		if ( function_exists( 'ini_set' ) ) {
			ini_set( 'zlib.output_compression', '0' ); // phpcs:ignore WordPress.PHP.IniSet.Risky, Squiz.PHP.DiscouragedFunctions.Discouraged
		}

		status_header( $this->status ? $this->status : 200 );
		header( 'Content-Type: ' . ( $this->content_type ? $this->content_type : 'text/event-stream' ) );
		header( 'Cache-Control: no-cache' );
		// Asks nginx not to buffer the answer.
		header( 'X-Accel-Buffering: no' );
	}
}

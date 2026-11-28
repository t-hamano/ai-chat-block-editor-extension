<?php
/**
 * @package Blocktune
 */

use Blocktune\Stream;

/**
 * A stream that records the status and content type it would send, instead
 * of sending headers and closing the test's output buffers.
 */
class Blocktune_Test_Stream extends Stream {

	/**
	 * The status and content type at the time the output started, if it did.
	 *
	 * @var array|null
	 */
	public $started_with;

	/**
	 * Records the status and content type.
	 */
	protected function start_stream_output() {
		$this->started_with = array( $this->status, $this->content_type );
	}
}

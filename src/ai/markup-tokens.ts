/**
 * Matches a reference ID comment before a block, such as `<!-- ref:b12 -->`,
 * and takes the ID.
 */
export const REF_COMMENT = /<!--\s*ref:([a-z0-9]+)\s*-->/gi;

/**
 * Matches a reference ID comment before a block, such as `<!-- ref:b12 -->`,
 * or a block delimiter with the block's name: an opening one, a closing one
 * starting with `/wp:`, or a self-closing one ending with `/-->`.
 *
 * The groups are the reference ID, the `/` of a closing delimiter, the
 * block's name, and the `/` of a self-closing delimiter.
 */
export const BLOCK_TOKEN =
	/<!--\s*ref:([a-z0-9]+)\s*-->|<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(?:\{[\s\S]*?\}\s+)?(\/)?-->/gi;

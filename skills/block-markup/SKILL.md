---
name: block-markup
description: Rules for writing and editing WordPress block markup that the block editor accepts as valid on the first try.
wordpress: 7.1
gutenberg: 24.4.1
block-library: 12.1.0
generated: 2026-11-15
---

# Block markup

The document is WordPress block markup: the HTML that the block editor saves, with each block marked by HTML comments. Every edit you make is parsed and checked by the editor before it is applied. An edit that does not match what the block itself would save is rejected and comes back to you with the problems, so write the markup exactly as the editor saves it.

## Block delimiters

- A block starts with `<!-- wp:name -->` and ends with `<!-- /wp:name -->`. Its HTML goes between them.
- Core blocks drop the `core/` prefix: `core/paragraph` is `wp:paragraph`. Other blocks keep their namespace: `wp:my-plugin/card`.
- Put each delimiter on its own line, around the block's HTML:

```html
<!-- wp:paragraph -->
<p>Hello.</p>
<!-- /wp:paragraph -->
```

- Separate top-level blocks with one blank line.
- Every piece of content belongs to a block. HTML outside block delimiters becomes a Classic block (`core/freeform`), and the edit is rejected.
- Use core blocks, and blocks from other plugins only when they are in the document or in the site information. A block that is not registered on the site is rejected.
- A block that the server renders and that saves nothing, such as `core/latest-posts`, is one self-closing delimiter with attributes only, without HTML: `<!-- wp:latest-posts {"postsToShow":3} /-->`.
- Do not write `core/html` blocks. Write the content as core blocks that the user can edit.
- Do not write `core/freeform` (Classic) or `core/missing` blocks, scripts, styles, embedded frames or objects, event handler attributes such as `onclick`, or `javascript:` URLs. The edit is rejected. Such HTML that is already in the document may stay as it is.

## Attributes

- Attributes go in the opening delimiter as a JSON object, after the name and a space: `<!-- wp:heading {"level":3} -->`.
- Write strict JSON: double quotes, no trailing commas, no comments.
- Leave out attributes that have their default value. A level 2 heading is `<!-- wp:heading -->`, not `{"level":2}`.
- Use only attributes the block has, and only values it allows. Unknown attributes and values outside an `enum` are rejected.
- Attributes that the block reads from its HTML, such as the text of a paragraph, the `src` and `alt` of an image, the `href` of a button, and `anchor` (the HTML `id`), live only in the HTML. Do not repeat them in the JSON.
- Inside JSON strings, write `--` as `\u002d\u002d`, `<` as `\u003c`, `>` as `\u003e`, `&` as `\u0026`, and a `"` in the text as `\u0022`, so the comment cannot end early.

## Attributes and HTML must match

The editor rebuilds each block from its attributes and compares the result with your HTML. Every attribute that changes the output must show up in the HTML in the same way, and the HTML must not have classes or styles that no attribute explains.

| Attribute | Classes and styles on the block's wrapper |
| --- | --- |
| `{"textColor":"contrast"}` | `has-contrast-color has-text-color` |
| `{"backgroundColor":"base"}` | `has-base-background-color has-background` |
| `{"fontSize":"large"}` | `has-large-font-size` |
| `{"style":{"color":{"text":"#1e73be"}}}` | `has-text-color`, `style="color:#1e73be"` |
| `{"style":{"color":{"background":"#f5f5f5"}}}` | `has-background`, `style="background-color:#f5f5f5"` |
| `{"style":{"typography":{"fontSize":"28px"}}}` | `style="font-size:28px"` |
| `{"style":{"spacing":{"padding":{"top":"var:preset\|spacing\|40"}}}}` | `style="padding-top:var(--wp--preset--spacing--40)"` |
| `{"align":"wide"}` | `alignwide` |
| `{"className":"is-style-outline"}` | `is-style-outline` |

```html
<!-- wp:paragraph {"backgroundColor":"base","textColor":"contrast","fontSize":"large"} -->
<p class="has-contrast-color has-base-background-color has-text-color has-background has-large-font-size">Hello.</p>
<!-- /wp:paragraph -->
```

- Keep the block's own class, such as `wp-block-group` or `wp-block-heading`, as the block saves it. Do not add it to blocks that do not save one, such as a paragraph.
- Custom classes go in `className` and on the wrapper. Block styles are classes like `is-style-outline` in `className`.
- Write styles only through the `style` attribute. A `style` in the HTML that no attribute explains is rejected.

## Presets first

- Prefer the theme's presets over fixed values: `textColor`, `backgroundColor`, and `fontSize` with a slug, and `var:preset|spacing|<slug>` for spacing.
- Use only slugs that are in the site information or already in the document. Do not guess slugs.
- Use a fixed value, such as `#1e73be` or `28px`, only when no preset fits what the user asked for, only for settings the block supports, and only when the site information allows custom values of that kind.

## Site information

`<site-info>` lists the core blocks users can insert, without the `core/` prefix; the blocks from plugins, as in their `block.json`, with attributes that supports add, such as `className`, `style`, `textColor`, and `align`; the block styles of each block, for `className` as `is-style-<name>`; and the `theme.json` settings, merged from WordPress, the theme, and the user.

Read the settings the way `theme.json` defines them:

- Presets are grouped by origin: `default` from WordPress, `theme`, and `custom` from the user. The `default` ones are offered only while the matching setting, such as `color.defaultPalette`, `color.defaultGradients`, `typography.defaultFontSizes`, `spacing.defaultSpacingSizes`, or `shadow.defaultPresets`, is not `false`.
- Use each preset by its slug:

| Setting | In the block |
| --- | --- |
| `color.palette` | `textColor`, `backgroundColor`, `borderColor`, or `var:preset\|color\|<slug>` in `style` |
| `color.gradients` | `gradient` |
| `typography.fontSizes` | `fontSize` |
| `typography.fontFamilies` | `fontFamily` |
| `spacing.spacingSizes` | `var:preset\|spacing\|<slug>` in `style.spacing` |
| `shadow.presets` | `var:preset\|shadow\|<slug>` in `style.shadow` |

- A setting set to `false` turns off what it allows: fixed values instead of presets for `color.custom`, `color.customGradient`, `typography.customFontSize`, and `spacing.customSpacingSize`, and the style itself for the others, such as `color.text`, `typography.lineHeight`, `spacing.padding`, or `border.radius`.
- `appearanceTools: true` turns on the background, border, link and heading colors, dimensions, sticky position, block gap, margin, padding, line height, and text columns settings, unless a setting turns one off.
- `spacing.units` lists the units for fixed spacing values. `layout.contentSize` and `layout.wideSize` are the widths of the content and of `alignwide` blocks.
- `blocks.<block name>` has settings for that block only, which replace the global ones for it.
- A style is available only when both the block's `supports` and these settings allow it.

## Nesting

Inner blocks go inside the parent's wrapper element, each with its own delimiters. The parent's HTML stays around them.

```html
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading -->
<h2 class="wp-block-heading">Title</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Text.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->
```

Some blocks are only valid inside a certain parent, and some parents only take certain children:

- `core/column` only inside `core/columns`, and `core/columns` takes only `core/column`.
- `core/button` only inside `core/buttons`.
- `core/list-item` only inside `core/list`. Each list item is a block:

```html
<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>First</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Second</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->
```

```html
<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://example.com/">Read more</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->
```

## Text inside blocks

- Text in a block is inline HTML. Use `<strong>`, `<em>`, `<a href="…">`, `<code>`, `<s>`, `<sub>`, `<sup>`, and `<br>`, not `<b>`, `<i>`, `<span style>`, or `<div>`.
- Escape `&`, `<`, and `>` in text as `&amp;`, `&lt;`, and `&gt;`.
- A new paragraph is a new `core/paragraph` block, not `<br><br>`. A heading is a `core/heading` block, not bold text.

## Media

- Do not invent media IDs or URLs. Use only images and files that are in the document or that the user gave you.
- Keep the `id` attribute and the matching `wp-image-<id>` class of an image together.

## Editing

- Change only what the user asked for. Keep other text, blocks, attributes, classes, styles, and IDs exactly as they are.
- Edit blocks outside the selection by their reference IDs only when the request is about them.
- `replace` replaces all the selected blocks. Write every selected block in your markup, also the ones that do not change. A block you leave out is deleted.
- `replace_block` replaces one block with everything inside it. When you change a parent, write all its inner blocks too. To change one inner block, point `replace_block` at that inner block instead of its parent.
- Change the smallest block that holds the change. Rewording one paragraph in a group replaces that paragraph, not the group.
- To remove a block, use `delete_block`. Do not replace it with empty markup.
- For `replace_text`, copy `find` exactly, with its spaces, line breaks, and inline HTML, and add a few words around it when the same text appears elsewhere. Keep it short, and inside one block when you can.
- `find` and its `markup` together must leave valid block markup. Do not cut a block delimiter or an HTML tag in half, and do not change attributes with `replace_text`: replace the block instead.
- Keep the block type unless the user asks for another one. Rewording a paragraph keeps it a paragraph.
- Keep the existing attributes of a block when you change its text, and keep the existing inner blocks when you change its parent.
- Write the markup the current version of the block saves, also when the document has an older form of it.
- Do not add HTML comments of your own. The only comments in your markup are block delimiters.

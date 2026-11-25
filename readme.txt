=== Blocktune – AI Block Editing Chat ===
Contributors: wildworks
Donate link: https://www.paypal.me/thamanoJP
Tags: ai, gutenberg, block, editor, chat
Requires at least: 7.1
Tested up to: 7.2
Stable tag: 0.1.0
Requires PHP: 8.3
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Select blocks or text in the block editor and edit them by chatting with AI.

== Description ==

Blocktune adds an AI chat to the block editor. Select blocks or a piece of text, tell the AI what you want to change, and it edits the content for you.

**Edit What You Select**

Select one or more blocks, or just a few words inside a block, and ask the AI to rewrite, translate, summarize, or restyle them. Only the selected part is changed.

**Understands Your Site**

The AI knows the blocks available on your site and the colors, font sizes, and other presets of your theme, so its edits fit your site.

**Works With Long Documents**

Long posts are sent as an outline, and the AI reads only the parts it needs.

**Uses Your Own API Keys**

The plugin uses the API keys registered on the Connectors screen in WordPress. Install an AI provider plugin, such as AI Provider for Anthropic, and set its API key.

Only users with administrator privileges can use this plugin, and only super admins on a multisite network, because requests are sent with the site's API keys.

== Installation ==

1. Upload the `blocktune` folder to the `/wp-content/plugins/` directory.
2. Activate the plugin through the 'Plugins' menu in WordPress.
3. Install an AI provider plugin and set its API key on the Connectors screen.

== Frequently Asked Questions ==

= Does it cost anything to use? =

The plugin is free, but the AI provider charges for each request, based on the amount of text sent and received. The provider bills you directly, under the account that owns the API key. Nothing is paid to the plugin author.

= How can I avoid unexpected charges? =

We recommend setting a monthly spend limit in your provider's console before you start. When the limit is reached, the provider stops answering until the next month. For OpenAI, turn on "Enforce a hard limit", or the limit only sends alerts. The usage may go slightly over the limit, because providers take a few minutes to apply it.

* Anthropic: https://platform.claude.com/docs/en/api/rate-limits#setting-your-own-spend-limit
* OpenAI: https://developers.openai.com/api/docs/guides/spend-limits
* Google: https://aistudio.google.com/docs/billing

Long posts and long conversations use more text per request. Start a new conversation when you move on to a different task.

= Where can I check how much I have used? =

Each answer in the chat shows how many tokens it used. For the exact usage and cost, check the usage page of your provider. The Chat settings in the sidebar also link to these pages.

* Anthropic: https://platform.claude.com/usage
* OpenAI: https://platform.openai.com/usage
* Google: https://aistudio.google.com/usage

= Which AI providers and models can I use? =

Anthropic, OpenAI, and Google are fully supported. Other providers work too, if their provider plugin supports the AI Client in WordPress. To choose the provider and model, open the Chat settings in the sidebar. By default, the first connected provider among Anthropic, OpenAI, and Google is used.

= Where is my API key stored? =

The plugin does not store API keys. It uses the key set on the Connectors screen in WordPress. The key is used only on the server and is never sent to the browser.

= What data is sent to the AI provider? =

Your message, the selected blocks or text, and parts of the post needed for the edit. See the "External services" section for details.

= Are my conversations saved? =

No. Conversations are kept only while the editor is open, and are cleared when you reload the page. Only your choice of provider and model is saved.

== Screenshots ==

1. Select text or blocks, ask the AI, and see the changes in the editor

== External services ==

This plugin sends content to an AI provider to edit it. It connects only to the provider whose API key is set on the Connectors screen, and only when an administrator or a super admin uses the AI chat in the block editor.

For Anthropic, OpenAI, and Google, the plugin connects to the provider directly, so that the answer appears as it is written. The AI Client in WordPress returns the whole answer at once, so it is not used for these providers. The requests still go through the WordPress HTTP API, and the site's settings that turn AI off still apply. Other providers go through the AI Client.

When you send a message, the following data is sent to the provider: your message and the conversation so far, the selected blocks or text, an outline or parts of the post being edited, and a list of the blocks and theme presets available on the site. The site's API key is sent with each request. To show the models you can choose, the plugin also asks the provider for its list of models.

= Anthropic (Claude) =

Used when an Anthropic API key is set. Data is sent to `api.anthropic.com`.

* Terms of service: https://www.anthropic.com/legal/commercial-terms
* Privacy policy: https://www.anthropic.com/legal/privacy

= OpenAI =

Used when an OpenAI API key is set. Data is sent to `api.openai.com`.

* Terms of use: https://openai.com/policies/row-terms-of-use/
* Privacy policy: https://openai.com/policies/privacy-policy/

= Google (Gemini API) =

Used when a Google API key is set. Data is sent to `generativelanguage.googleapis.com`.

* Terms of service: https://ai.google.dev/gemini-api/terms
* Privacy policy: https://policies.google.com/privacy

= Other providers =

For other AI provider plugins, the conversation is sent through the AI Client in WordPress to the service of that provider. See the terms and privacy policy of the provider you use.

== Resources ==

= react-markdown =

* License: MIT License
* Source: https://github.com/remarkjs/react-markdown

= remark-gfm =

* License: MIT License
* Source: https://github.com/remarkjs/remark-gfm

= uuid =

* License: MIT License
* Source: https://github.com/uuidjs/uuid

== Changelog ==

= 0.1.0 =

* Initial release

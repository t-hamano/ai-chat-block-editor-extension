# Blocktune – AI Block Editing Chat

[![Test](https://github.com/t-hamano/blocktune/actions/workflows/test.yml/badge.svg)](https://github.com/t-hamano/blocktune/actions/workflows/test.yml)

![Blocktune](https://raw.githubusercontent.com/t-hamano/blocktune/main/.wordpress-org/banner-1544x500.png)

Select blocks or text in the block editor and edit them by chatting with AI. The plugin uses the API keys registered on the Connectors screen in WordPress core.

![Blocktune demo](https://raw.githubusercontent.com/t-hamano/blocktune/main/.wordpress-org/screenshot-1.gif)

## Features

### Edit What You Select, or the Whole Post

Select one or more blocks, or just a few words inside a block, and tell the AI what you want to change. With nothing selected, the AI reads the whole post and decides where to edit, insert, or delete blocks. Changed blocks are outlined and changed text is highlighted, and every edit is a single undo step.

### Knows Your Site, Saves Tokens

The AI automatically knows your site's blocks and theme presets, so its edits fit your site. Long posts are sent as an outline and the AI reads only the parts it needs, and repeated context is cached, keeping token usage low. Each answer shows the tokens it used.

### Streaming Answers

Answers from Anthropic, OpenAI, and Google stream into the chat as they are written, so you don't have to wait for the whole reply.

### Built on WordPress Connectors

The plugin uses the API keys registered on the Connectors screen in WordPress core, so there are no extra keys to manage. Press the gear icon to choose from the providers and models available through your connectors, and your choice is saved for each user.

## Requirements

* WordPress 7.1 or later
* PHP 8.3 or later
* An AI provider plugin, such as AI Provider for Anthropic, with an API key on the Connectors screen

## Usage

1. Open a post or page in the block editor.
2. Open the Blocktune sidebar from the sparkle icon in the top toolbar, or from **Blocktune** in the Options menu.
3. Choose what to edit:
   * **Blocks**: select one or more blocks. Only the selected blocks are changed.
   * **Text inside a block**: select a few words. Only that text is changed.
   * **Nothing**: the AI reads the whole post and decides where to edit, insert, or delete blocks.
4. Type what you want, such as "Translate this into Japanese" or "Make this heading shorter", and press **Send**. The answer appears as it is written, and you can press **Stop** at any time.
5. Changed blocks are outlined, and changed text is colored for a few seconds. If the first change is off screen, the editor scrolls to it. With reduced motion turned on, the color does not fade, and the editor jumps to the change instead of scrolling smoothly.

Each edit is a single undo step, so you can take it back with the editor's Undo button. Press **New conversation** (the plus icon) to start over.

### Choosing the provider and model

By default, the AI assistant picks a provider in the order Anthropic, OpenAI, Google, and uses a recommended model from that provider. The recommended models balance quality and price, such as Claude Sonnet for Anthropic, so the most expensive models are used only when you choose them. With the recommended models of Anthropic, OpenAI, and Google, the model also thinks less before it answers than the provider's default, so it answers faster and costs less. Other models keep the provider's default. To choose them yourself, press the gear icon at the top right of the sidebar. Only providers with an API key and their models are listed. The choice is saved for each user.

## Limitations

* Only administrators can use the AI assistant, and only super admins on a multisite network, where the API keys can be shared by every site. There is no setting to allow other roles.
* Answers stream only for Anthropic, OpenAI, and Google. Other providers run through the AI Client in WordPress and show the answer all at once.
* Each answer keeps one PHP worker of your server busy until the provider finishes, for up to 5 minutes. On servers that hold streamed answers back, the whole answer comes at once, and a proxy or CDN in front of the site may stop waiting first (often after 60 to 100 seconds). Long answers can then fail with a timeout error.
* The AI edits post content only. Global Styles, templates, and template parts are out of scope.
* When a text selection spans more than one block, the whole blocks are edited.
* Every edit is checked before it is applied, and broken markup is never applied. When an edit or a read fails, for example because of broken markup or a block that does not exist, the AI can try again. After the fourth failure in one answer, the chat shows that the edit could not be made.
* When you change a block while the AI is answering, the AI does not overwrite your change. It reads the block again, and edits it from what it is now.
* Styling is limited to what each block and the theme allow, and theme presets are used where possible.
* The AI does not add new images or files. It only uses media that is already in the post or that you give it.
* Long posts (over about 60,000 characters of block markup) are sent as an outline, and the AI reads only the parts it needs. This saves tokens, but the AI may miss context it did not read.
* The conversation is not saved. It is cleared when you reload the editor.
* Your content is sent to the AI provider. See the "External services" section of [readme.txt](readme.txt) for what is sent and when.

## How to build

```sh
npm install
npm run build
```

## How to evaluate

`npm run eval` sends a few fixed requests to a real model and checks what the assistant did, to measure changes to the prompt or the token use. See [scripts/eval/README.md](scripts/eval/README.md).

## Author

[Aki Hamano (GitHub)](https://github.com/t-hamano)

declare module '*.scss';

declare module '*?raw' {
	const content: string;
	export default content;
}

// The block library publishes no types for its entry point.
declare module '@wordpress/block-library' {
	export function registerCoreBlocks(): void;
}

// Set by the plugin when it enqueues the editor script.
interface Window {
	blocktune: {
		hasApiKey: boolean;
		/**
		 * The providers in `PROVIDERS` that have an API key when the editor loads.
		 */
		providers: string[];
		connectorsUrl: string;
	};
}

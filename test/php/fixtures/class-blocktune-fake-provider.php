<?php
/**
 * @package Blocktune
 */

use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Providers\AbstractProvider;
use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;
use WordPress\AiClient\Providers\DTO\ProviderMetadata;
use WordPress\AiClient\Providers\Enums\ProviderTypeEnum;
use WordPress\AiClient\Providers\Http\Enums\RequestAuthenticationMethod;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;

/**
 * Stands in for the Anthropic provider plugin. It takes an API key and has
 * no models, so tests can give the AI Client a key without the plugin.
 */
class Blocktune_Fake_Provider extends AbstractProvider {

	const ID = 'anthropic';

	protected static function createModel( ModelMetadata $model_metadata, ProviderMetadata $provider_metadata ): ModelInterface {
		throw new RuntimeException( 'The fake provider has no models.' );
	}

	protected static function createProviderMetadata(): ProviderMetadata {
		return new ProviderMetadata( static::ID, 'Fake', ProviderTypeEnum::cloud(), null, RequestAuthenticationMethod::apiKey() );
	}

	protected static function createProviderAvailability(): ProviderAvailabilityInterface {
		return new class() implements ProviderAvailabilityInterface {
			public function isConfigured(): bool {
				return true;
			}
		};
	}

	protected static function createModelMetadataDirectory(): ModelMetadataDirectoryInterface {
		return new class() implements ModelMetadataDirectoryInterface {
			public function listModelMetadata(): array {
				return array();
			}

			public function hasModelMetadata( string $model_id ): bool {
				return false;
			}

			public function getModelMetadata( string $model_id ): ModelMetadata {
				throw new RuntimeException( 'The fake provider has no models.' );
			}
		};
	}
}

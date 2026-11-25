<?php
/**
 * @package Blocktune
 */

use WordPress\AiClient\Common\Exception\RuntimeException;
use WordPress\AiClient\Messages\DTO\Message;
use WordPress\AiClient\Messages\DTO\ModelMessage;
use WordPress\AiClient\Messages\DTO\MessagePart;
use WordPress\AiClient\Messages\Enums\ModalityEnum;
use WordPress\AiClient\Providers\AbstractProvider;
use WordPress\AiClient\Providers\Contracts\ModelMetadataDirectoryInterface;
use WordPress\AiClient\Providers\Contracts\ProviderAvailabilityInterface;
use WordPress\AiClient\Providers\DTO\ProviderMetadata;
use WordPress\AiClient\Providers\Enums\ProviderTypeEnum;
use WordPress\AiClient\Providers\Models\Contracts\ModelInterface;
use WordPress\AiClient\Providers\Models\DTO\ModelConfig;
use WordPress\AiClient\Providers\Models\DTO\ModelMetadata;
use WordPress\AiClient\Providers\Models\DTO\SupportedOption;
use WordPress\AiClient\Providers\Models\Enums\CapabilityEnum;
use WordPress\AiClient\Providers\Models\Enums\OptionEnum;
use WordPress\AiClient\Providers\Models\TextGeneration\Contracts\TextGenerationModelInterface;
use WordPress\AiClient\Results\DTO\Candidate;
use WordPress\AiClient\Results\DTO\GenerativeAiResult;
use WordPress\AiClient\Results\DTO\TokenUsage;
use WordPress\AiClient\Results\Enums\FinishReasonEnum;

/**
 * Stands in for a provider the relay does not know. Its models record the
 * prompt they get and answer with `$answer`, instead of calling an API.
 */
class Blocktune_Fallback_Provider extends AbstractProvider {

	const ID = 'fallback-test';

	const MODELS = array( 'test-model', 'other-model' );

	/**
	 * The messages and config of the last prompt, and the model that got it.
	 *
	 * @var array|null
	 */
	public static $prompt;

	/**
	 * The message the models answer with. Text when null.
	 *
	 * @var Message|null
	 */
	public static $answer;

	/**
	 * Creates the metadata of one of the models.
	 *
	 * @param string $id The model ID.
	 * @return ModelMetadata
	 */
	public static function model_metadata( string $id ): ModelMetadata {
		return new ModelMetadata(
			$id,
			$id,
			array( CapabilityEnum::textGeneration(), CapabilityEnum::chatHistory() ),
			array(
				new SupportedOption( OptionEnum::systemInstruction() ),
				new SupportedOption( OptionEnum::functionDeclarations() ),
				new SupportedOption( OptionEnum::inputModalities(), array( array( ModalityEnum::text() ) ) ),
				new SupportedOption( OptionEnum::outputModalities(), array( array( ModalityEnum::text() ) ) ),
			)
		);
	}

	protected static function createModel( ModelMetadata $model_metadata, ProviderMetadata $provider_metadata ): ModelInterface {
		return new class( $model_metadata, $provider_metadata ) implements ModelInterface, TextGenerationModelInterface {

			private $config;

			public function __construct( private ModelMetadata $model_metadata, private ProviderMetadata $provider_metadata ) {
				$this->config = new ModelConfig();
			}

			public function metadata(): ModelMetadata {
				return $this->model_metadata;
			}

			public function providerMetadata(): ProviderMetadata {
				return $this->provider_metadata;
			}

			public function setConfig( ModelConfig $config ): void {
				$this->config = $config;
			}

			public function getConfig(): ModelConfig {
				return $this->config;
			}

			public function generateTextResult( array $prompt ): GenerativeAiResult {
				Blocktune_Fallback_Provider::$prompt = array(
					'model'    => $this->model_metadata->getId(),
					'messages' => array_map( static fn( Message $message ) => $message->toArray(), $prompt ),
					'config'   => $this->config,
				);

				$answer = Blocktune_Fallback_Provider::$answer ?? new ModelMessage( array( new MessagePart( 'Hi' ) ) );

				return new GenerativeAiResult(
					'result-id',
					array( new Candidate( $answer, FinishReasonEnum::stop() ) ),
					new TokenUsage( 12, 3, 15 ),
					$this->provider_metadata,
					$this->model_metadata
				);
			}
		};
	}

	protected static function createProviderMetadata(): ProviderMetadata {
		return new ProviderMetadata( self::ID, 'Fallback test', ProviderTypeEnum::cloud() );
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
				return array_map( array( Blocktune_Fallback_Provider::class, 'model_metadata' ), Blocktune_Fallback_Provider::MODELS );
			}

			public function hasModelMetadata( string $model_id ): bool {
				return in_array( $model_id, Blocktune_Fallback_Provider::MODELS, true );
			}

			public function getModelMetadata( string $model_id ): ModelMetadata {
				if ( ! $this->hasModelMetadata( $model_id ) ) {
					throw new RuntimeException( 'No such model.' );
				}
				return Blocktune_Fallback_Provider::model_metadata( $model_id );
			}
		};
	}
}

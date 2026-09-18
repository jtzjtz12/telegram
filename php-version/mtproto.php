<?php
declare(strict_types=1);

/**
 * MTProto Userbot Client for Telegram Voice Transcriber
 * 
 * Powered by danog/madelineproto.
 * Interacts with Telegram MTProto API as a regular user account to forward
 * audio voice notes to @speech_transcriber_bot and receive transcriptions.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';

use danog\MadelineProto\API as MadelineProtoAPI;
use danog\MadelineProto\Settings;
use danog\MadelineProto\Settings\Logger as MadelineLoggerSettings;
use danog\MadelineProto\Logger as MadelineLogger;
use danog\MadelineProto\LocalFile;
use danog\MadelineProto\RPCErrorException;

class TelegramMtProto
{
    private ?MadelineProtoAPI $mp = null;
    private string $sessionFile;
    private string $sessionDir;
    private int $apiId;
    private string $apiHash;
    private string $botUsername;
    private ?array $selfUser = null;

    /**
     * Intermediate status markers returned by @speech_transcriber_bot
     */
    public const INTERMEDIATE_STATUS_KEYWORDS = [
        'распознаю',
        'обрабатываю',
        'обработка',
        'загрузка',
        'подождите',
        'секунду',
        'конвертирую',
        'processing',
        'transcribing',
        'converting',
        'audio received',
        'working on it',
        '⏳',
        '🎙',
        '...',
    ];

    public function __construct(
        ?string $sessionFile = null,
        ?int $apiId = null,
        ?string $apiHash = null,
        ?string $botUsername = null
    ) {
        $this->sessionFile = $sessionFile ?? (string) Config::get('telegram_session_file');
        $this->sessionDir = dirname($this->sessionFile);
        $this->apiId = $apiId ?? (int) Config::get('telegram_api_id', 0);
        $this->apiHash = $apiHash ?? (string) Config::get('telegram_api_hash', '');
        $this->botUsername = ltrim($botUsername ?? (string) Config::get('transcriber_bot_username', 'speech_transcriber_bot'), '@');

        if (!is_dir($this->sessionDir)) {
            @mkdir($this->sessionDir, 0775, true);
        }
    }

    /**
     * Connects to Telegram MTProto network using MadelineProto.
     *
     * @return bool True if connected/initialized successfully.
     */
    public function connect(): bool
    {
        if ($this->mp !== null) {
            return true;
        }

        if ($this->apiId <= 0 || empty($this->apiHash)) {
            Logger::warn('MTProto credentials missing: TELEGRAM_API_ID or TELEGRAM_API_HASH is empty');
            return false;
        }

        try {
            Logger::info('Initializing MadelineProto MTProto client...', [
                'session_dir' => $this->sessionDir,
                'api_id' => $this->apiId,
            ]);

            $settings = new Settings();
            $settings->getAppInfo()->setApiId($this->apiId);
            $settings->getAppInfo()->setApiHash($this->apiHash);

            // Redirect Madeline internal logging to logs/madeline.log to keep stdout clean
            $logsDir = (string) Config::get('logs_dir', dirname(__DIR__) . '/logs');
            if (!is_dir($logsDir)) {
                @mkdir($logsDir, 0775, true);
            }
            $settings->getLogger()->setLevel(MadelineLogger::LEVEL_ERROR);
            $settings->getLogger()->setType(MadelineLogger::LOGGER_FILE);
            $settings->getLogger()->setExtra($logsDir . '/madeline.log');

            $this->mp = new MadelineProtoAPI($this->sessionFile, $settings);

            $authStatus = $this->mp->getAuthorization();
            $isAuthorized = ($authStatus === MadelineProtoAPI::LOGGED_IN);

            Logger::info('MadelineProto client initialized', [
                'auth_status' => $authStatus,
                'is_authorized' => $isAuthorized,
            ]);

            if ($isAuthorized) {
                $this->getSelf();
            }

            return true;
        } catch (\Throwable $e) {
            Logger::error('Failed to initialize MadelineProto client: ' . $e->getMessage(), [
                'exception' => get_class($e),
            ]);
            return false;
        }
    }

    /**
     * Checks if current session is authorized as a Telegram user account.
     */
    public function isAuthorized(): bool
    {
        if ($this->mp === null) {
            if (!$this->connect()) {
                return false;
            }
        }

        try {
            return $this->mp !== null && $this->mp->getAuthorization() === MadelineProtoAPI::LOGGED_IN;
        } catch (\Throwable $e) {
            Logger::error('Error checking authorization status: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Retrieves information about the currently logged-in Telegram user.
     */
    public function getSelf(): ?array
    {
        if (!$this->isAuthorized()) {
            return null;
        }

        if ($this->selfUser !== null) {
            return $this->selfUser;
        }

        try {
            $self = $this->mp->getSelf();
            if (is_array($self)) {
                $this->selfUser = [
                    'id' => (int) ($self['id'] ?? 0),
                    'first_name' => (string) ($self['first_name'] ?? ''),
                    'last_name' => (string) ($self['last_name'] ?? ''),
                    'username' => (string) ($self['username'] ?? ''),
                    'phone' => (string) ($self['phone'] ?? ''),
                    'is_bot' => (bool) ($self['bot'] ?? false),
                ];
                return $this->selfUser;
            }
        } catch (\Throwable $e) {
            Logger::error('Failed to retrieve self user info: ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Resolves and verifies availability of @speech_transcriber_bot.
     * Handles YOU_BLOCKED_USER error gracefully.
     */
    public function getTranscriberBot(): array
    {
        if (!$this->isAuthorized()) {
            return [
                'ok' => false,
                'error' => 'MTProto client is not authorized. Run: php auth.php',
                'bot_username' => $this->botUsername,
            ];
        }

        try {
            Logger::info("Looking up transcriber bot @{$this->botUsername} via MTProto...");
            $info = $this->mp->getInfo($this->botUsername);

            $userId = 0;
            $username = $this->botUsername;
            $firstName = '';

            if (is_array($info)) {
                $userObj = $info['User'] ?? $info['bot'] ?? $info;
                $userId = (int) ($userObj['id'] ?? $info['bot_api_id'] ?? 0);
                $username = (string) ($userObj['username'] ?? $this->botUsername);
                $firstName = (string) ($userObj['first_name'] ?? '');
            }

            Logger::info("Found transcriber bot @{$username}", [
                'bot_id' => $userId,
                'first_name' => $firstName,
            ]);

            return [
                'ok' => true,
                'id' => $userId,
                'username' => $username,
                'first_name' => $firstName,
                'is_bot' => true,
            ];
        } catch (RPCErrorException $e) {
            $rpcError = $e->rpc ?? $e->getMessage();
            if (str_contains($rpcError, 'YOU_BLOCKED_USER') || str_contains($e->getMessage(), 'YOU_BLOCKED_USER')) {
                $blockedMsg = "MTProto account has blocked the transcriber bot. Unblock @{$this->botUsername} in Telegram.";
                Logger::error($blockedMsg);
                return [
                    'ok' => false,
                    'blocked' => true,
                    'error' => $blockedMsg,
                    'bot_username' => $this->botUsername,
                ];
            }

            Logger::error("Telegram RPC error looking up bot @{$this->botUsername}: " . $e->getMessage());
            return [
                'ok' => false,
                'error' => "Telegram RPC Error: " . $e->getMessage(),
                'bot_username' => $this->botUsername,
            ];
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'YOU_BLOCKED_USER')) {
                $blockedMsg = "MTProto account has blocked the transcriber bot. Unblock @{$this->botUsername} in Telegram.";
                Logger::error($blockedMsg);
                return [
                    'ok' => false,
                    'blocked' => true,
                    'error' => $blockedMsg,
                    'bot_username' => $this->botUsername,
                ];
            }

            Logger::error("Error looking up @{$this->botUsername}: " . $e->getMessage());
            return [
                'ok' => false,
                'error' => $e->getMessage(),
                'bot_username' => $this->botUsername,
            ];
        }
    }

    /**
     * Sends a local audio file as a voice message to @speech_transcriber_bot.
     *
     * @param string $localFilePath Path to audio file on disk (.oga/.ogg/.mp3)
     * @param string|null $caption Optional caption
     * @return array Result array with message_id, date, ok
     */
    public function sendVoice(string $localFilePath, ?string $caption = null): array
    {
        if (!file_exists($localFilePath)) {
            $err = "Audio file not found at path: {$localFilePath}";
            Logger::error($err);
            return ['ok' => false, 'error' => $err];
        }

        $size = filesize($localFilePath);
        if ($size === 0 || $size === false) {
            $err = "Audio file is empty (0 bytes): {$localFilePath}";
            Logger::error($err);
            return ['ok' => false, 'error' => $err];
        }

        if (!$this->isAuthorized()) {
            $err = 'Cannot send audio file: MTProto user account is not authorized. Run: php auth.php';
            Logger::error($err);
            return ['ok' => false, 'error' => $err];
        }

        try {
            Logger::info("Sending voice note to @{$this->botUsername} via MTProto...", [
                'file_path' => $localFilePath,
                'file_size' => $size,
            ]);

            $localFile = new LocalFile($localFilePath);
            $sent = $this->mp->sendVoice(
                peer: $this->botUsername,
                file: $localFile,
                caption: $caption ?? ''
            );

            $messageId = 0;
            $date = time();

            if (is_object($sent)) {
                $messageId = (int) ($sent->id ?? 0);
                $date = (int) ($sent->date ?? time());
            } elseif (is_array($sent)) {
                $messageId = (int) ($sent['id'] ?? 0);
                $date = (int) ($sent['date'] ?? time());
                if ($messageId === 0 && isset($sent['updates'])) {
                    foreach ($sent['updates'] as $upd) {
                        if (isset($upd['message']['id'])) {
                            $messageId = (int) $upd['message']['id'];
                            break;
                        }
                    }
                }
            }

            Logger::info("[MTProto SENT] Voice message sent to @{$this->botUsername}", [
                'message_id' => $messageId,
                'date' => $date,
            ]);

            return [
                'ok' => true,
                'message_id' => $messageId,
                'date' => $date,
            ];
        } catch (RPCErrorException $e) {
            $rpcError = $e->rpc ?? $e->getMessage();
            if (str_contains($rpcError, 'YOU_BLOCKED_USER') || str_contains($e->getMessage(), 'YOU_BLOCKED_USER')) {
                $msg = "MTProto account has blocked the transcriber bot. Unblock @{$this->botUsername} in Telegram.";
                Logger::error($msg);
                return ['ok' => false, 'blocked' => true, 'error' => $msg];
            }
            Logger::error("RPC error sending voice note: " . $e->getMessage());
            return ['ok' => false, 'error' => $e->getMessage()];
        } catch (\Throwable $e) {
            Logger::error("Error sending voice note: " . $e->getMessage());
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Waits for incoming transcription message from @speech_transcriber_bot.
     *
     * Distinguishes intermediate status messages from final transcriptions.
     * Supports both new incoming messages and in-place message edits.
     *
     * @param int $sentMessageId The message ID of our sent voice message
     * @param int $timeout Maximum wait duration in seconds (default 180)
     * @param callable|null $onProgress Optional callback for intermediate progress updates
     * @return array ['ok' => bool, 'transcription' => string, 'incoming_message_id' => int, 'wait_time_sec' => float]
     */
    public function waitForTranscription(
        int $sentMessageId,
        int $timeout = 180,
        ?callable $onProgress = null
    ): array {
        if (!$this->isAuthorized()) {
            return [
                'ok' => false,
                'error' => 'MTProto client is not authorized. Run: php auth.php',
            ];
        }

        $startTime = microtime(true);
        $pollIntervalSec = (float) Config::get('transcriber_poll_interval_ms', 1000) / 1000.0;
        if ($pollIntervalSec < 0.5) {
            $pollIntervalSec = 0.5;
        }

        Logger::info("[MTProto WAIT] Waiting for transcription from @{$this->botUsername}...", [
            'sent_message_id' => $sentMessageId,
            'timeout_seconds' => $timeout,
        ]);

        $lastSeenIntermediate = '';

        while ((microtime(true) - $startTime) < $timeout) {
            $elapsedSec = round(microtime(true) - $startTime, 2);

            try {
                // Fetch recent dialog messages from @speech_transcriber_bot
                $history = $this->mp->messages->getHistory([
                    'peer' => $this->botUsername,
                    'limit' => 10,
                ]);

                $messages = $history['messages'] ?? [];
                if (is_array($messages)) {
                    foreach ($messages as $msg) {
                        // Only inspect incoming messages from the bot (out === false)
                        $isOut = (bool) ($msg['out'] ?? false);
                        if ($isOut) {
                            continue;
                        }

                        $msgId = (int) ($msg['id'] ?? 0);
                        $replyToId = (int) ($msg['reply_to']['reply_to_msg_id'] ?? $msg['reply_to_msg_id'] ?? 0);

                        // Message must either reply to our sent voice note or have arrived after it
                        $isCorrelated = ($replyToId === $sentMessageId) || ($sentMessageId > 0 && $msgId > $sentMessageId);

                        if (!$isCorrelated && $sentMessageId > 0) {
                            continue;
                        }

                        $rawText = (string) ($msg['message'] ?? '');
                        $cleanText = trim($rawText);

                        if ($cleanText === '') {
                            continue;
                        }

                        // Check if this is an intermediate progress indicator
                        if (self::isIntermediateStatus($cleanText)) {
                            if ($cleanText !== $lastSeenIntermediate) {
                                $lastSeenIntermediate = $cleanText;
                                Logger::info("[MTProto WAIT] Intermediate progress received, job continues waiting", [
                                    'sent_message_id' => $sentMessageId,
                                    'incoming_message_id' => $msgId,
                                    'elapsed_sec' => $elapsedSec,
                                    'status_text' => $cleanText,
                                ]);

                                if ($onProgress !== null) {
                                    $onProgress([
                                        'status' => 'intermediate',
                                        'message_id' => $msgId,
                                        'text' => $cleanText,
                                        'elapsed_sec' => $elapsedSec,
                                    ]);
                                }
                            }
                            // Continue waiting for the final transcription
                            continue;
                        }

                        // Final transcription received!
                        Logger::info("[TRANSCRIPTION RECEIVED]\nsent_message_id={$sentMessageId}\nincoming_message_id={$msgId}\ntext={$cleanText}", [
                            'sent_message_id' => $sentMessageId,
                            'incoming_message_id' => $msgId,
                            'wait_seconds' => $elapsedSec,
                            'text_length' => mb_strlen($cleanText, 'UTF-8'),
                        ]);

                        return [
                            'ok' => true,
                            'transcription' => $cleanText,
                            'incoming_message_id' => $msgId,
                            'wait_time_sec' => $elapsedSec,
                        ];
                    }
                }
            } catch (RPCErrorException $e) {
                $rpcError = $e->rpc ?? $e->getMessage();
                if (str_contains($rpcError, 'YOU_BLOCKED_USER') || str_contains($e->getMessage(), 'YOU_BLOCKED_USER')) {
                    $msg = "MTProto account has blocked the transcriber bot. Unblock @{$this->botUsername} in Telegram.";
                    Logger::error($msg);
                    return ['ok' => false, 'blocked' => true, 'error' => $msg];
                }
                Logger::warn("Warning while fetching history from @{$this->botUsername}: " . $e->getMessage());
            } catch (\Throwable $e) {
                Logger::warn("Warning while polling transcription: " . $e->getMessage());
            }

            usleep((int) ($pollIntervalSec * 1_000_000));
        }

        $totalElapsed = round(microtime(true) - $startTime, 2);
        $timeoutMsg = "Timeout waiting for transcription from @{$this->botUsername} after {$timeout} seconds";
        Logger::error($timeoutMsg, [
            'sent_message_id' => $sentMessageId,
            'elapsed_sec' => $totalElapsed,
        ]);

        return [
            'ok' => false,
            'error' => $timeoutMsg,
            'wait_time_sec' => $totalElapsed,
        ];
    }

    /**
     * Determines whether a message text is an intermediate processing marker.
     */
    public static function isIntermediateStatus(string $text): bool
    {
        $normalized = mb_strtolower(trim($text), 'UTF-8');
        if (mb_strlen($normalized, 'UTF-8') > 100) {
            return false;
        }

        foreach (self::INTERMEDIATE_STATUS_KEYWORDS as $keyword) {
            if (str_contains($normalized, $keyword)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Gets underlying MadelineProto API instance if needed.
     */
    public function getMadelineProto(): ?MadelineProtoAPI
    {
        return $this->mp;
    }

    public function getSessionDir(): string
    {
        return $this->sessionDir;
    }

    public function getSessionFile(): string
    {
        return $this->sessionFile;
    }

    public function getBotUsername(): string
    {
        return $this->botUsername;
    }
}

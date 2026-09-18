<?php
declare(strict_types=1);

/**
 * Telegram Bot API Client for PHP Transcriber
 * 
 * Implements:
 * - getMe()
 * - deleteWebhook()
 * - getUpdates()
 * - getFile()
 * - downloadFile()
 * - sendMessage()
 * - deleteMessage()
 * 
 * Features:
 * - Structured responses for all methods.
 * - HTTP and Telegram error handling.
 * - Automatic logging with token redaction.
 * - Resilient Guzzle HTTP client with native cURL fallback.
 * - Safe timeouts (configured per call).
 */

namespace Transcriber;

use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\RequestOptions;
use Throwable;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';

class TelegramBotApi
{
    private string $token;
    private string $baseUrl;
    private string $fileBaseUrl;
    private ?GuzzleClient $httpClient = null;

    public function __construct(?string $token = null)
    {
        $this->token = $token ?? (string) Config::get('telegram_bot_token', '');
        $this->baseUrl = 'https://api.telegram.org/bot' . $this->token;
        $this->fileBaseUrl = 'https://api.telegram.org/file/bot' . $this->token;

        if (class_exists(GuzzleClient::class)) {
            $this->httpClient = new GuzzleClient([
                'timeout' => 35,
                'connect_timeout' => 10,
                'http_errors' => false,
            ]);
        }
    }

    public function isConfigured(): bool
    {
        return !empty($this->token);
    }

    public function getToken(): string
    {
        return $this->token;
    }

    /**
     * Test bot authentication and get bot identity
     */
    public function getMe(): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('getMe');
        }

        $res = $this->callApi('getMe');
        if (!$res['ok']) {
            Logger::error("Telegram Bot API getMe failed", ['error' => $res['description'] ?? 'Unknown error']);
        }
        return $res;
    }

    /**
     * Delete webhook (essential before starting long polling)
     */
    public function deleteWebhook(bool $dropPendingUpdates = false): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('deleteWebhook');
        }

        $params = ['drop_pending_updates' => $dropPendingUpdates];
        $res = $this->callApi('deleteWebhook', $params);

        if (!$res['ok']) {
            Logger::warn("Telegram Bot API deleteWebhook error", [
                'description' => $res['description'] ?? 'Unknown error',
                'drop_pending_updates' => $dropPendingUpdates,
            ]);
        } else {
            Logger::info("Telegram Bot API webhook deleted", [
                'drop_pending_updates' => $dropPendingUpdates,
            ]);
        }

        return $res;
    }

    /**
     * Long polling updates fetcher
     */
    public function getUpdates(int $offset = 0, int $limit = 100, int $timeout = 20): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('getUpdates');
        }

        $params = [
            'offset' => $offset,
            'limit' => max(1, min(100, $limit)),
            'timeout' => max(0, $timeout),
            'allowed_updates' => json_encode(['message', 'channel_post']),
        ];

        // HTTP timeout must exceed long-poll timeout
        $httpTimeout = $timeout + 15;
        $res = $this->callApi('getUpdates', $params, $httpTimeout);

        if (!$res['ok']) {
            Logger::error("Telegram Bot API getUpdates failed", [
                'offset' => $offset,
                'error' => $res['description'] ?? $res['error'] ?? 'Unknown error',
            ]);
        }

        return $res;
    }

    /**
     * Get file info (including remote file_path) from Telegram
     */
    public function getFile(string $fileId): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('getFile');
        }

        $res = $this->callApi('getFile', ['file_id' => $fileId]);
        if (!$res['ok']) {
            Logger::error("Telegram Bot API getFile failed", [
                'file_id' => $fileId,
                'error' => $res['description'] ?? 'Unknown error',
            ]);
            return [
                'ok' => false,
                'file_path' => null,
                'file_size' => null,
                'error' => $res['description'] ?? 'Failed to get file info',
                'raw' => $res,
            ];
        }

        $result = $res['result'] ?? [];
        return [
            'ok' => true,
            'file_id' => $result['file_id'] ?? $fileId,
            'file_path' => $result['file_path'] ?? null,
            'file_size' => $result['file_size'] ?? null,
            'error' => null,
            'raw' => $res,
        ];
    }

    /**
     * Download a file by remote path to a local directory or file path
     */
    public function downloadFile(string $remoteFilePath, string $localSavePath): array
    {
        if (!$this->isConfigured()) {
            return [
                'ok' => false,
                'local_path' => null,
                'file_size' => 0,
                'error' => 'TELEGRAM_BOT_TOKEN is not configured',
            ];
        }

        $targetFile = $localSavePath;
        // If localSavePath is a directory, generate filename
        if (is_dir($localSavePath)) {
            $ext = pathinfo($remoteFilePath, PATHINFO_EXTENSION) ?: 'oga';
            $fileName = 'voice_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
            $targetFile = rtrim($localSavePath, '/') . '/' . $fileName;
        }

        $targetDir = dirname($targetFile);
        if (!is_dir($targetDir)) {
            @mkdir($targetDir, 0775, true);
        }

        $downloadUrl = "{$this->fileBaseUrl}/{$remoteFilePath}";

        try {
            if ($this->httpClient !== null) {
                $response = $this->httpClient->get($downloadUrl, [
                    RequestOptions::TIMEOUT => 60,
                    RequestOptions::SINK => $targetFile,
                ]);
                $statusCode = $response->getStatusCode();
                if ($statusCode !== 200) {
                    @unlink($targetFile);
                    $errMsg = "Download failed with HTTP {$statusCode}";
                    Logger::error($errMsg, ['remote_path' => $remoteFilePath]);
                    return ['ok' => false, 'local_path' => null, 'file_size' => 0, 'error' => $errMsg];
                }
            } else {
                // cURL fallback
                $fp = fopen($targetFile, 'wb');
                if (!$fp) {
                    throw new \RuntimeException("Cannot open file for writing: {$targetFile}");
                }
                $ch = curl_init($downloadUrl);
                curl_setopt_array($ch, [
                    CURLOPT_FILE => $fp,
                    CURLOPT_TIMEOUT => 60,
                    CURLOPT_FOLLOWLOCATION => true,
                ]);
                curl_exec($ch);
                $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlError = curl_error($ch);
                curl_close($ch);
                fclose($fp);

                if ($curlError || $statusCode !== 200) {
                    @unlink($targetFile);
                    $errMsg = $curlError ?: "HTTP {$statusCode}";
                    Logger::error("Download failed via cURL", ['error' => $errMsg]);
                    return ['ok' => false, 'local_path' => null, 'file_size' => 0, 'error' => $errMsg];
                }
            }

            if (!file_exists($targetFile) || filesize($targetFile) === 0) {
                @unlink($targetFile);
                $errMsg = "Downloaded file is empty or does not exist";
                Logger::error($errMsg, ['target' => $targetFile]);
                return ['ok' => false, 'local_path' => null, 'file_size' => 0, 'error' => $errMsg];
            }

            $size = (int) filesize($targetFile);
            Logger::info("Downloaded voice file", [
                'remote_path' => $remoteFilePath,
                'local_path' => $targetFile,
                'bytes' => $size,
            ]);

            return [
                'ok' => true,
                'local_path' => $targetFile,
                'file_size' => $size,
                'error' => null,
            ];
        } catch (Throwable $e) {
            @unlink($targetFile);
            $safeError = Logger::sanitize($e->getMessage());
            Logger::error("Exception while downloading voice file", ['error' => $safeError]);
            return [
                'ok' => false,
                'local_path' => null,
                'file_size' => 0,
                'error' => $safeError,
            ];
        }
    }

    /**
     * Send message to Telegram chat
     * 
     * Strategy:
     * Attempt 1: with reply_to_message_id (if specified)
     * Attempt 2: fallback without reply_to_message_id if attempt 1 failed
     */
    public function sendMessage(string|int $chatId, string $text, ?int $replyToMessageId = null): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('sendMessage');
        }

        $chatIdStr = (string) $chatId;

        // Attempt 1: with reply_to_message_id if present
        if ($replyToMessageId !== null && $replyToMessageId > 0) {
            $params = [
                'chat_id' => $chatIdStr,
                'text' => $text,
                'reply_to_message_id' => $replyToMessageId,
            ];
            $res = $this->callApi('sendMessage', $params);

            if ($res['ok'] && isset($res['result']['message_id'])) {
                return [
                    'ok' => true,
                    'message_id' => (int) $res['result']['message_id'],
                    'fallback_used' => false,
                    'result' => $res['result'],
                    'error' => null,
                ];
            }

            Logger::warn("sendMessage with reply_to_message_id failed, attempting fallback direct send", [
                'chat_id' => $chatIdStr,
                'reply_to' => $replyToMessageId,
                'error' => $res['description'] ?? 'Unknown error',
            ]);
        }

        // Attempt 2: direct message without reply_to_message_id
        $params = [
            'chat_id' => $chatIdStr,
            'text' => $text,
        ];
        $res = $this->callApi('sendMessage', $params);

        if ($res['ok'] && isset($res['result']['message_id'])) {
            return [
                'ok' => true,
                'message_id' => (int) $res['result']['message_id'],
                'fallback_used' => ($replyToMessageId !== null),
                'result' => $res['result'],
                'error' => null,
            ];
        }

        Logger::error("Telegram Bot API sendMessage failed completely", [
            'chat_id' => $chatIdStr,
            'error' => $res['description'] ?? 'Unknown error',
        ]);

        return [
            'ok' => false,
            'message_id' => null,
            'fallback_used' => false,
            'result' => null,
            'error' => $res['description'] ?? 'Failed to send message',
        ];
    }

    /**
     * Delete a message in a Telegram chat
     */
    public function deleteMessage(string|int $chatId, int $messageId): array
    {
        if (!$this->isConfigured()) {
            return $this->notConfiguredResponse('deleteMessage');
        }

        $params = [
            'chat_id' => (string) $chatId,
            'message_id' => $messageId,
        ];

        $res = $this->callApi('deleteMessage', $params);
        $deleted = ($res['ok'] && ($res['result'] === true));

        if (!$deleted) {
            Logger::warn("Telegram Bot API deleteMessage failed", [
                'chat_id' => (string) $chatId,
                'message_id' => $messageId,
                'error' => $res['description'] ?? 'Unknown error',
            ]);
        } else {
            Logger::info("Telegram Bot API message deleted", [
                'chat_id' => (string) $chatId,
                'message_id' => $messageId,
            ]);
        }

        return [
            'ok' => $res['ok'],
            'deleted' => $deleted,
            'description' => $res['description'] ?? null,
            'error' => $deleted ? null : ($res['description'] ?? 'Could not delete message'),
        ];
    }

    /**
     * Core HTTP request handler
     */
    public function callApi(string $method, array $params = [], int $timeout = 30): array
    {
        $url = "{$this->baseUrl}/{$method}";

        try {
            if ($this->httpClient !== null) {
                $response = $this->httpClient->post($url, [
                    RequestOptions::JSON => $params,
                    RequestOptions::TIMEOUT => $timeout,
                ]);

                $statusCode = $response->getStatusCode();
                $body = (string) $response->getBody();
                $data = json_decode($body, true);

                if (!is_array($data)) {
                    $errMsg = "Invalid JSON response from Telegram API (HTTP {$statusCode})";
                    Logger::error($errMsg, ['method' => $method]);
                    return [
                        'ok' => false,
                        'status_code' => $statusCode,
                        'description' => $errMsg,
                        'error' => $errMsg,
                        'result' => null,
                    ];
                }

                $ok = (bool) ($data['ok'] ?? false);
                return [
                    'ok' => $ok,
                    'status_code' => $statusCode,
                    'result' => $data['result'] ?? null,
                    'description' => $data['description'] ?? ($ok ? null : "Telegram error ({$statusCode})"),
                    'error' => $ok ? null : ($data['description'] ?? "HTTP {$statusCode}"),
                    'error_code' => $data['error_code'] ?? $statusCode,
                ];
            }

            // cURL fallback
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($params),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
            ]);

            $rawResult = curl_exec($ch);
            $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            if ($curlError) {
                $errMsg = Logger::sanitize("cURL error: {$curlError}");
                Logger::error("Bot API transport error", ['error' => $errMsg, 'method' => $method]);
                return [
                    'ok' => false,
                    'status_code' => 0,
                    'description' => $errMsg,
                    'error' => $errMsg,
                    'result' => null,
                ];
            }

            $data = json_decode((string) $rawResult, true);
            if (!is_array($data)) {
                $errMsg = "Invalid JSON response from Telegram API";
                Logger::error($errMsg, ['method' => $method]);
                return [
                    'ok' => false,
                    'status_code' => $statusCode,
                    'description' => $errMsg,
                    'error' => $errMsg,
                    'result' => null,
                ];
            }

            $ok = (bool) ($data['ok'] ?? false);
            return [
                'ok' => $ok,
                'status_code' => $statusCode,
                'result' => $data['result'] ?? null,
                'description' => $data['description'] ?? null,
                'error' => $ok ? null : ($data['description'] ?? "HTTP {$statusCode}"),
                'error_code' => $data['error_code'] ?? $statusCode,
            ];
        } catch (Throwable $e) {
            $safeError = Logger::sanitize($e->getMessage());
            Logger::error("Exception in callApi({$method})", ['error' => $safeError]);
            return [
                'ok' => false,
                'status_code' => 0,
                'description' => $safeError,
                'error' => $safeError,
                'result' => null,
            ];
        }
    }

    private function notConfiguredResponse(string $method): array
    {
        return [
            'ok' => false,
            'status_code' => 0,
            'description' => 'TELEGRAM_BOT_TOKEN is not configured',
            'error' => 'TELEGRAM_BOT_TOKEN is not configured',
            'result' => null,
        ];
    }
}

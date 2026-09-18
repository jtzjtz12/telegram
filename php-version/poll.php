<?php
declare(strict_types=1);

/**
 * Telegram Bot API Long Polling Service for PHP Transcriber
 * 
 * Features:
 * - deleteWebhook(false) initialization before polling.
 * - getUpdates with long polling timeout (~20s).
 * - Offset tracking to guarantee no duplicate update ingestion.
 * - Filters for voice/audio messages only.
 * - Downloads audio to php-version/data/audio/.
 * - Creates 'pending' job in SQLite with duplicate protection.
 * - Structured logging (tokens redacted).
 * - Safe test mode (--test) for diagnostics without infinite loop.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/bot_api.php';

class BotPoller
{
    private TelegramBotApi $api;
    private string $audioDir;
    private int $pollTimeout;
    private bool $running = true;

    public function __construct(?TelegramBotApi $api = null)
    {
        $this->api = $api ?? new TelegramBotApi();
        $this->audioDir = (string) Config::get('audio_dir', __DIR__ . '/data/audio');
        $this->pollTimeout = (int) Config::get('bot_poll_timeout', 20);

        if (!is_dir($this->audioDir)) {
            @mkdir($this->audioDir, 0775, true);
        }
    }

    /**
     * Start the long polling loop
     */
    public function start(): void
    {
        if (!$this->api->isConfigured()) {
            Logger::error("Cannot start polling: TELEGRAM_BOT_TOKEN is not configured in .env");
            echo "Error: TELEGRAM_BOT_TOKEN is not configured.\n";
            return;
        }

        // Setup process signals for graceful shutdown
        if (function_exists('pcntl_signal')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGINT, function () {
                Logger::info("Received SIGINT, shutting down poller gracefully...");
                $this->running = false;
            });
            pcntl_signal(SIGTERM, function () {
                Logger::info("Received SIGTERM, shutting down poller gracefully...");
                $this->running = false;
            });
        }

        Logger::info("Initializing Telegram Bot API poller...");

        // 1. Delete webhook before polling starts
        $webhookRes = $this->api->deleteWebhook(false);
        if (!$webhookRes['ok']) {
            Logger::warn("Webhook removal warning", ['description' => $webhookRes['description'] ?? '']);
        }

        // 2. Verify bot credentials
        $me = $this->api->getMe();
        if (!$me['ok']) {
            Logger::error("Failed to verify bot identity via getMe", ['error' => $me['description'] ?? '']);
            echo "Error verifying bot token: " . ($me['description'] ?? 'Unknown error') . "\n";
            return;
        }

        $botUser = $me['result']['username'] ?? 'UnknownBot';
        Logger::info("Bot authenticated successfully as @{$botUser}. Starting long polling...", [
            'bot_username' => $botUser,
            'poll_timeout' => $this->pollTimeout,
        ]);

        $offset = 0;
        $consecutiveErrors = 0;

        while ($this->running) {
            try {
                Logger::debug("Calling getUpdates", ['offset' => $offset, 'timeout' => $this->pollTimeout]);
                $updatesRes = $this->api->getUpdates($offset, limit: 100, timeout: $this->pollTimeout);

                if (!$updatesRes['ok']) {
                    $consecutiveErrors++;
                    $delay = min(15, $consecutiveErrors * 2);
                    Logger::warn("getUpdates error received, backing off for {$delay}s", [
                        'error' => $updatesRes['description'] ?? 'Unknown error',
                    ]);
                    sleep($delay);
                    continue;
                }

                $consecutiveErrors = 0;
                $updates = $updatesRes['result'] ?? [];

                if (empty($updates)) {
                    continue;
                }

                Logger::info("Received " . count($updates) . " update(s) from Telegram");

                foreach ($updates as $update) {
                    $updateId = (int) ($update['update_id'] ?? 0);
                    $offset = max($offset, $updateId + 1);

                    $this->processUpdate($update);
                }
            } catch (\Throwable $e) {
                Logger::error("Unexpected exception in polling loop", ['error' => Logger::sanitize($e->getMessage())]);
                sleep(3);
            }
        }

        Logger::info("Telegram Bot API polling stopped cleanly.");
    }

    /**
     * Ingest and process a single update
     */
    public function processUpdate(array $update): ?int
    {
        $updateId = (int) ($update['update_id'] ?? 0);
        $message = $update['message'] ?? $update['channel_post'] ?? null;

        if (!$message) {
            Logger::debug("Ignoring non-message update #{$updateId}");
            return null;
        }

        $chatId = (string) ($message['chat']['id'] ?? '');
        $messageId = (int) ($message['message_id'] ?? 0);
        $senderId = (string) ($message['from']['id'] ?? $chatId);

        // Check if message is a voice note or audio file
        $voice = $message['voice'] ?? $message['audio'] ?? null;
        if (!$voice || empty($voice['file_id'])) {
            Logger::debug("Ignoring non-voice message #{$messageId} in chat {$chatId}");
            return null;
        }

        $fileId = (string) $voice['file_id'];
        $mimeType = (string) ($voice['mime_type'] ?? 'audio/ogg');
        $duration = (int) ($voice['duration'] ?? 0);

        Logger::info("Received voice message from Telegram", [
            'chat_id' => $chatId,
            'message_id' => $messageId,
            'sender_id' => $senderId,
            'file_id' => $fileId,
            'duration' => $duration,
            'mime_type' => $mimeType,
        ]);

        // Protection against duplicate processing: chat_id + message_id
        if (Database::hasJobForChatMessage($chatId, $messageId)) {
            Logger::info("Voice message #{$messageId} in chat {$chatId} already exists in jobs queue. Skipping duplicate.");
            return null;
        }

        // 1. Get file information from Telegram
        $fileInfo = $this->api->getFile($fileId);
        if (!$fileInfo['ok'] || empty($fileInfo['file_path'])) {
            Logger::error("Could not obtain file path for voice note", [
                'file_id' => $fileId,
                'chat_id' => $chatId,
                'message_id' => $messageId,
                'error' => $fileInfo['error'] ?? 'Unknown file error',
            ]);
            return null;
        }

        $remotePath = (string) $fileInfo['file_path'];

        // 2. Download file to local audio directory
        $downloadRes = $this->api->downloadFile($remotePath, $this->audioDir);
        if (!$downloadRes['ok'] || empty($downloadRes['local_path'])) {
            Logger::error("Failed to download voice file to disk", [
                'file_id' => $fileId,
                'remote_path' => $remotePath,
                'error' => $downloadRes['error'] ?? 'Download failed',
            ]);
            return null;
        }

        $localFilePath = $downloadRes['local_path'];
        Logger::info("Voice file saved locally", [
            'chat_id' => $chatId,
            'message_id' => $messageId,
            'local_path' => $localFilePath,
            'file_size' => $downloadRes['file_size'],
        ]);

        // 3. Create job in SQLite with status 'pending'
        try {
            $jobId = Database::createJob(
                telegramChatId: $chatId,
                telegramMessageId: $messageId,
                senderUserId: $senderId,
                originalFileId: $fileId,
                localFilePath: $localFilePath
            );

            Logger::info("Created job in SQLite queue", [
                'job_id' => $jobId,
                'chat_id' => $chatId,
                'message_id' => $messageId,
                'status' => 'pending',
            ]);

            return $jobId;
        } catch (\Throwable $e) {
            Logger::error("Database error while creating job", [
                'chat_id' => $chatId,
                'message_id' => $messageId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Safe test mode: checks bot connection, webhook, recent updates, and database
     * Does not loop or process tasks.
     */
    public function runDiagnostics(): array
    {
        echo "=======================================================\n";
        echo "   Telegram Bot API Layer — Diagnostics & Test Mode    \n";
        echo "=======================================================\n\n";

        $results = [
            'token_configured' => $this->api->isConfigured(),
            'get_me' => false,
            'bot_username' => null,
            'delete_webhook' => false,
            'get_updates' => false,
            'sqlite_check' => false,
            'duplicate_guard_check' => false,
        ];

        // 1. Check token
        echo "1. Token Configuration:\n";
        if (!$this->api->isConfigured()) {
            echo "   [!] TELEGRAM_BOT_TOKEN is not configured in .env\n";
            echo "       (Live Telegram API tests will be skipped)\n\n";
        } else {
            echo "   [+] TELEGRAM_BOT_TOKEN is configured.\n\n";
        }

        // 2. getMe()
        echo "2. Testing getMe():\n";
        if ($this->api->isConfigured()) {
            $me = $this->api->getMe();
            if ($me['ok']) {
                $results['get_me'] = true;
                $results['bot_username'] = $me['result']['username'] ?? null;
                echo "   [+] getMe() SUCCESS: Connected as @" . ($results['bot_username'] ?? 'unknown') . "\n";
                echo "       Bot ID: " . ($me['result']['id'] ?? 'unknown') . "\n";
                echo "       Bot Name: " . ($me['result']['first_name'] ?? '') . "\n\n";
            } else {
                echo "   [-] getMe() FAILED: " . ($me['description'] ?? 'Unknown error') . "\n\n";
            }
        } else {
            echo "   [i] Skipped (no token)\n\n";
        }

        // 3. deleteWebhook()
        echo "3. Testing deleteWebhook(drop_pending_updates=false):\n";
        if ($this->api->isConfigured()) {
            $del = $this->api->deleteWebhook(false);
            if ($del['ok']) {
                $results['delete_webhook'] = true;
                echo "   [+] deleteWebhook() SUCCESS: Webhook cleared for long polling.\n\n";
            } else {
                echo "   [-] deleteWebhook() FAILED: " . ($del['description'] ?? 'Unknown error') . "\n\n";
            }
        } else {
            echo "   [i] Skipped (no token)\n\n";
        }

        // 4. getUpdates()
        echo "4. Testing getUpdates(offset=0, limit=5, timeout=0):\n";
        if ($this->api->isConfigured()) {
            $updates = $this->api->getUpdates(offset: 0, limit: 5, timeout: 0);
            if ($updates['ok']) {
                $results['get_updates'] = true;
                $count = count($updates['result'] ?? []);
                echo "   [+] getUpdates() SUCCESS: Retrieved {$count} pending update(s).\n\n";
            } else {
                echo "   [-] getUpdates() FAILED: " . ($updates['description'] ?? 'Unknown error') . "\n\n";
            }
        } else {
            echo "   [i] Skipped (no token)\n\n";
        }

        // 5. SQLite database check & duplicate guard test
        echo "5. Testing SQLite Database & Duplicate Guard:\n";
        try {
            $pdo = Database::getConnection();
            $stats = Database::getStats();
            $results['sqlite_check'] = true;
            echo "   [+] SQLite connected successfully. Total jobs in DB: {$stats['total']}\n";

            // Test duplicate guard with a synthetic test entry
            $testChat = 'test_diag_chat_' . time();
            $testMsg = 999999;
            $testFile = 'test_file_id';
            $testLocal = '/tmp/test_voice.oga';

            $job1 = Database::createJob($testChat, $testMsg, 'test_user', $testFile, $testLocal);
            $job2 = Database::createJob($testChat, $testMsg, 'test_user', $testFile, $testLocal);

            if ($job1 === $job2) {
                $results['duplicate_guard_check'] = true;
                echo "   [+] Duplicate guard VERIFIED: Re-submitting chat {$testChat} + msg {$testMsg} returned existing job #{$job1} without creating duplicates.\n";
            } else {
                echo "   [-] Duplicate guard FAILED: Created different job IDs ({$job1} vs {$job2})\n";
            }

            // Clean up test entry
            $pdo->prepare("DELETE FROM jobs WHERE telegram_chat_id = :c")->execute([':c' => $testChat]);
            echo "   [+] Cleaned up temporary diagnostic job record.\n\n";
        } catch (\Throwable $e) {
            echo "   [-] SQLite check failed: " . $e->getMessage() . "\n\n";
        }

        echo "-------------------------------------------------------\n";
        echo "Diagnostics Summary:\n";
        echo " - Token Configured:       " . ($results['token_configured'] ? "YES" : "NO") . "\n";
        echo " - Bot API getMe():        " . ($results['get_me'] ? "PASS (@{$results['bot_username']})" : "SKIPPED/FAIL") . "\n";
        echo " - Bot API deleteWebhook():" . ($results['delete_webhook'] ? "PASS" : "SKIPPED/FAIL") . "\n";
        echo " - Bot API getUpdates():   " . ($results['get_updates'] ? "PASS" : "SKIPPED/FAIL") . "\n";
        echo " - SQLite & Schema:        " . ($results['sqlite_check'] ? "PASS" : "FAIL") . "\n";
        echo " - Duplicate Guard:        " . ($results['duplicate_guard_check'] ? "PASS" : "FAIL") . "\n";
        echo "=======================================================\n";

        return $results;
    }
}

// CLI entry point
if (php_sapi_name() === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $poller = new BotPoller();
    
    // Check if --test flag passed
    $isTest = false;
    foreach ($argv ?? [] as $arg) {
        if ($arg === '--test' || $arg === '-t' || $arg === 'test') {
            $isTest = true;
            break;
        }
    }

    if ($isTest) {
        $poller->runDiagnostics();
    } else {
        $poller->start();
    }
}

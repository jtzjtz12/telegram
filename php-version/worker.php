<?php
declare(strict_types=1);

/**
 * Transcriber Background Queue Worker Stub
 * 
 * Future pipeline:
 * 1. Polls SQLite for pending jobs (1 at a time).
 * 2. Forwards local voice file to @speech_transcriber_bot via MadelineProto MTProto.
 * 3. Waits for transcription response with timeout.
 * 4. Filters out intermediate progress markers.
 * 5. Sends result back to source chat via Bot API.
 * 6. Deletes original voice message strictly after successful reply.
 * 
 * Safe skeleton: Does not invoke live MTProto or Telegram network calls at this stage.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/bot_api.php';

class TranscriberWorker
{
    /**
     * Markers indicating intermediate processing status from @speech_transcriber_bot
     */
    private const INTERMEDIATE_STATUS_KEYWORDS = [
        'распознаю',
        'обрабатываю',
        'обработка',
        'загрузка',
        'подождите',
        'секунду',
        'processing',
        'transcribing',
        'converting',
        'audio received',
        'working on it',
        '⏳',
        '🎙',
        '...',
    ];

    public static function isIntermediateStatus(string $text): bool
    {
        $normalized = mb_strtolower(trim($text), 'UTF-8');
        if (mb_strlen($normalized, 'UTF-8') > 80) {
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
     * Run a single worker iteration (safe check of SQLite queue)
     */
    public function runOnce(): void
    {
        $stats = Database::getStats();
        echo sprintf(
            "[%s] Worker Queue Check: Total: %d | Pending: %d | Processing: %d | Completed: %d | Failed: %d\n",
            date('Y-m-d H:i:s'),
            $stats['total'] ?? 0,
            $stats['pending'] ?? 0,
            $stats['processing'] ?? 0,
            $stats['completed'] ?? 0,
            $stats['failed'] ?? 0
        );

        $pendingJobs = Database::getPendingJobs(1);
        if (empty($pendingJobs)) {
            echo "No pending jobs found in database.\n";
            return;
        }

        $job = $pendingJobs[0];
        echo "Found pending job ID #{$job['id']} for chat {$job['telegram_chat_id']}.\n";
        echo "Note: Live MTProto forwarding is disabled at this scaffolding stage.\n";
    }
}

// CLI entry point
if (php_sapi_name() === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    echo "=== Transcriber Worker Skeleton ===\n";
    $worker = new TranscriberWorker();
    $worker->runOnce();
}

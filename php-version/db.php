<?php
declare(strict_types=1);

/**
 * SQLite Database Service for PHP Transcriber
 * 
 * Manages database connection and provides CRUD operations for jobs.
 * Ensures exact schema compatibility with the Node.js version.
 */

namespace Transcriber;

use PDO;
use PDOException;

require_once __DIR__ . '/config.php';

class Database
{
    private static ?PDO $pdo = null;

    /**
     * Get or initialize PDO instance
     */
    public static function getConnection(?string $customDbPath = null): PDO
    {
        if (self::$pdo !== null && $customDbPath === null) {
            return self::$pdo;
        }

        $dbPath = $customDbPath ?? Config::get('database_path', __DIR__ . '/data/transcriber.db');
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $dsn = 'sqlite:' . $dbPath;
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];

        try {
            $pdo = new PDO($dsn, null, null, $options);
            $pdo->exec('PRAGMA journal_mode = WAL;');
            $pdo->exec('PRAGMA foreign_keys = ON;');
            $pdo->exec('PRAGMA busy_timeout = 5000;');

            if ($customDbPath === null) {
                self::$pdo = $pdo;
            }

            self::initSchema($pdo);
            return $pdo;
        } catch (PDOException $e) {
            throw new \RuntimeException("Failed to connect to SQLite at {$dbPath}: " . $e->getMessage(), 0, $e);
        }
    }

    /**
     * Creates table and indexes identical to the Node.js implementation
     */
    public static function initSchema(PDO $pdo): void
    {
        $sql = "
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_chat_id TEXT NOT NULL,
            telegram_message_id INTEGER NOT NULL,
            sender_user_id TEXT NOT NULL,
            original_file_id TEXT NOT NULL,
            local_file_path TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'waiting_transcription', 'completed', 'failed')),
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            transcription TEXT,
            error TEXT,
            transcriber_message_id INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            outgoing_mtproto_message_id INTEGER,
            bot_reply_message_id INTEGER,
            delete_status TEXT DEFAULT 'not_deleted',
            deleted_at TEXT,
            delete_error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_chat_msg ON jobs(telegram_chat_id, telegram_message_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        ";

        $pdo->exec($sql);
    }

    /**
     * Check if a job already exists for given telegram_chat_id and telegram_message_id
     */
    public static function findJobByChatMessage(string $telegramChatId, int $telegramMessageId): ?array
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            SELECT * FROM jobs 
            WHERE telegram_chat_id = :telegram_chat_id 
              AND telegram_message_id = :telegram_message_id 
            LIMIT 1
        ");
        $stmt->execute([
            ':telegram_chat_id' => $telegramChatId,
            ':telegram_message_id' => $telegramMessageId,
        ]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public static function hasJobForChatMessage(string $telegramChatId, int $telegramMessageId): bool
    {
        return self::findJobByChatMessage($telegramChatId, $telegramMessageId) !== null;
    }

    /**
     * Create a new job in 'pending' status.
     * Prevents duplicate rows if chat_id + message_id already exists.
     */
    public static function createJob(
        string $telegramChatId,
        int $telegramMessageId,
        string $senderUserId,
        string $originalFileId,
        string $localFilePath
    ): int {
        // Protection against duplicate processing
        $existing = self::findJobByChatMessage($telegramChatId, $telegramMessageId);
        if ($existing !== null) {
            return (int) $existing['id'];
        }

        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            INSERT INTO jobs (
                telegram_chat_id,
                telegram_message_id,
                sender_user_id,
                original_file_id,
                local_file_path,
                status,
                created_at,
                attempts,
                delete_status
            ) VALUES (
                :telegram_chat_id,
                :telegram_message_id,
                :sender_user_id,
                :original_file_id,
                :local_file_path,
                'pending',
                :created_at,
                0,
                'not_deleted'
            )
        ");

        $stmt->execute([
            ':telegram_chat_id' => $telegramChatId,
            ':telegram_message_id' => $telegramMessageId,
            ':sender_user_id' => $senderUserId,
            ':original_file_id' => $originalFileId,
            ':local_file_path' => $localFilePath,
            ':created_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ]);

        return (int) $pdo->lastInsertId();
    }

    /**
     * Fetch job by ID
     */
    public static function getJobById(int $id): ?array
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("SELECT * FROM jobs WHERE id = :id LIMIT 1");
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Get pending jobs ordered by creation date
     */
    public static function getPendingJobs(int $limit = 10): array
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            SELECT * FROM jobs 
            WHERE status = 'pending' 
            ORDER BY id ASC 
            LIMIT :limit
        ");
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /**
     * Update job status to 'processing'
     */
    public static function markProcessing(int $id): void
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            UPDATE jobs 
            SET status = 'processing', 
                started_at = :started_at,
                attempts = attempts + 1
            WHERE id = :id
        ");
        $stmt->execute([
            ':id' => $id,
            ':started_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ]);
    }

    /**
     * Mark job waiting for transcription from MTProto userbot
     */
    public static function markWaitingTranscription(int $id, int $outgoingMtprotoMessageId): void
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            UPDATE jobs 
            SET status = 'waiting_transcription', 
                outgoing_mtproto_message_id = :mtproto_msg_id
            WHERE id = :id
        ");
        $stmt->execute([
            ':id' => $id,
            ':mtproto_msg_id' => $outgoingMtprotoMessageId,
        ]);
    }

    /**
     * Mark job as completed
     */
    public static function markCompleted(
        int $id,
        string $transcription,
        ?int $botReplyMessageId = null
    ): void {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            UPDATE jobs 
            SET status = 'completed', 
                transcription = :transcription,
                bot_reply_message_id = :bot_reply_message_id,
                completed_at = :completed_at,
                error = NULL
            WHERE id = :id
        ");
        $stmt->execute([
            ':id' => $id,
            ':transcription' => $transcription,
            ':bot_reply_message_id' => $botReplyMessageId,
            ':completed_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ]);
    }

    /**
     * Mark job as failed
     */
    public static function markFailed(int $id, string $errorMessage): void
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            UPDATE jobs 
            SET status = 'failed', 
                error = :error,
                completed_at = :completed_at
            WHERE id = :id
        ");
        $stmt->execute([
            ':id' => $id,
            ':error' => $errorMessage,
            ':completed_at' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ]);
    }

    /**
     * Update delete status of the original voice note
     */
    public static function updateDeleteStatus(int $id, string $deleteStatus, ?string $error = null): void
    {
        $pdo = self::getConnection();
        $stmt = $pdo->prepare("
            UPDATE jobs 
            SET delete_status = :delete_status,
                deleted_at = :deleted_at,
                delete_error = :delete_error
            WHERE id = :id
        ");
        $stmt->execute([
            ':id' => $id,
            ':delete_status' => $deleteStatus,
            ':deleted_at' => $deleteStatus === 'deleted' ? (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM) : null,
            ':delete_error' => $error,
        ]);
    }

    /**
     * Get aggregate statistics
     */
    public static function getStats(): array
    {
        $pdo = self::getConnection();
        $stmt = $pdo->query("
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'waiting_transcription' THEN 1 ELSE 0 END) as waiting_transcription,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN delete_status = 'deleted' THEN 1 ELSE 0 END) as deleted_count
            FROM jobs
        ");
        return $stmt->fetch() ?: [];
    }
}

// CLI verification when executed directly: php db.php
if (php_sapi_name() === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    echo "=== Testing SQLite Database Connection ===\n";
    $pdo = Database::getConnection();
    echo "SQLite connected successfully.\n";
    
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")->fetchAll();
    if (!empty($tables)) {
        echo "Table 'jobs' verified.\n";
        $columns = $pdo->query("PRAGMA table_info(jobs)")->fetchAll();
        echo "Found " . count($columns) . " columns in 'jobs' table:\n";
        foreach ($columns as $col) {
            echo "  - {$col['name']} ({$col['type']})\n";
        }
        $stats = Database::getStats();
        echo "Current jobs count: {$stats['total']}\n";
        echo "SQLite validation PASSED.\n";
    } else {
        echo "Error: Table 'jobs' was not created.\n";
        exit(1);
    }
}

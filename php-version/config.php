<?php
declare(strict_types=1);

/**
 * Application Configuration for PHP Transcriber
 * 
 * Safe initialization:
 * - Loads .env via vlucas/phpdotenv if composer autoload is present.
 * - Gracefully falls back to basic .env parser or getenv() if vendor/autoload.php is not yet installed.
 * - Works safely even if .env is missing or variables are empty.
 */

namespace Transcriber;

class Config
{
    private static ?array $config = null;

    public static function load(string $baseDir = __DIR__): array
    {
        if (self::$config !== null) {
            return self::$config;
        }

        // 1. Try loading Dotenv if installed via Composer
        $autoload = $baseDir . '/vendor/autoload.php';
        if (file_exists($autoload)) {
            require_once $autoload;
            if (class_exists(\Dotenv\Dotenv::class)) {
                try {
                    $dotenv = \Dotenv\Dotenv::createImmutable($baseDir);
                    $dotenv->safeLoad();
                } catch (\Throwable $e) {
                    // Ignore loading errors to prevent crashes on empty/missing .env
                }
            }
        } else {
            // Fallback manual parser for .env when vendor is not installed yet
            self::loadEnvFile($baseDir . '/.env');
        }

        // 2. Ensure data, session and logs directories exist
        $dataDir = self::getEnv('DATA_DIR', $baseDir . '/data');
        $audioDir = self::getEnv('AUDIO_DIR', $dataDir . '/audio');
        $logsDir = self::getEnv('LOGS_DIR', $baseDir . '/logs');
        $sessionDir = self::getEnv('TELEGRAM_SESSION_DIR', $dataDir . '/telegram-session');
        $sessionFile = self::getEnv('TELEGRAM_SESSION_FILE', $sessionDir . '/session.madeline');
        $dbPath = self::getEnv('DATABASE_PATH', $dataDir . '/transcriber.db');

        if (!is_dir($dataDir)) {
            @mkdir($dataDir, 0775, true);
        }
        if (!is_dir($audioDir)) {
            @mkdir($audioDir, 0775, true);
        }
        if (!is_dir($logsDir)) {
            @mkdir($logsDir, 0775, true);
        }
        if (!is_dir($sessionDir)) {
            @mkdir($sessionDir, 0775, true);
        }

        self::$config = [
            'app_env' => self::getEnv('APP_ENV', 'development'),
            
            // Telegram Bot API
            'telegram_bot_token' => self::getEnv('TELEGRAM_BOT_TOKEN', ''),
            'bot_poll_timeout' => (int) self::getEnv('BOT_POLL_TIMEOUT', 20),

            // MTProto / MadelineProto Userbot Credentials
            'telegram_api_id' => (int) self::getEnv('TELEGRAM_API_ID', 0),
            'telegram_api_hash' => self::getEnv('TELEGRAM_API_HASH', ''),
            'telegram_user_phone' => self::getEnv('TELEGRAM_USER_PHONE', ''),
            'telegram_session_dir' => $sessionDir,
            'telegram_session_file' => $sessionFile,

            // Transcriber Bot Target & Timeouts
            'transcriber_bot_username' => self::getEnv('TRANSCRIBER_BOT_USERNAME', 'speech_transcriber_bot'),
            'transcriber_timeout_seconds' => (int) self::getEnv('TRANSCRIBER_TIMEOUT_SECONDS', 180),
            'transcriber_poll_interval_ms' => (int) self::getEnv('TRANSCRIBER_POLL_INTERVAL_MS', 1000),

            // Storage paths
            'data_dir' => $dataDir,
            'logs_dir' => $logsDir,
            'database_path' => $dbPath,
            'audio_dir' => $audioDir,
            'log_file_path' => self::getEnv('LOG_FILE_PATH', $logsDir . '/app.log'),
            'log_level' => self::getEnv('LOG_LEVEL', 'INFO'),
        ];

        // Also index uppercase keys for convenience
        foreach (self::$config as $key => $val) {
            self::$config[strtoupper($key)] = $val;
        }

        return self::$config;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $cfg = self::load();
        return $cfg[$key] ?? $default;
    }

    private static function getEnv(string $key, mixed $default = null): mixed
    {
        $val = getenv($key);
        if ($val !== false && $val !== '') {
            return $val;
        }
        if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
            return $_ENV[$key];
        }
        if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
            return $_SERVER[$key];
        }
        return $default;
    }

    private static function loadEnvFile(string $filePath): void
    {
        if (!file_exists($filePath) || !is_readable($filePath)) {
            return;
        }

        $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            if (str_contains($line, '=')) {
                [$key, $value] = explode('=', $line, 2);
                $key = trim($key);
                $value = trim($value, " \t\n\r\0\x0B\"'");
                if ($key !== '' && getenv($key) === false) {
                    putenv("{$key}={$value}");
                    $_ENV[$key] = $value;
                    $_SERVER[$key] = $value;
                }
            }
        }
    }
}

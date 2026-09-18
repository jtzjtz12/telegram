<?php
declare(strict_types=1);

/**
 * PSR-compliant Structured Logger for PHP Transcriber
 * 
 * Writes to LOG_FILE_PATH and STDOUT.
 * Sanitizes tokens and sensitive parameters automatically so they never appear in logs.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';

class Logger
{
    public const DEBUG = 100;
    public const INFO = 200;
    public const WARN = 300;
    public const ERROR = 400;

    private static array $levelMap = [
        'DEBUG' => self::DEBUG,
        'INFO' => self::INFO,
        'WARN' => self::WARN,
        'WARNING' => self::WARN,
        'ERROR' => self::ERROR,
    ];

    public static function log(string $level, string $message, array $context = []): void
    {
        $configuredLevelName = strtoupper((string) Config::get('log_level', 'INFO'));
        $configuredLevel = self::$levelMap[$configuredLevelName] ?? self::INFO;
        $currentLevel = self::$levelMap[strtoupper($level)] ?? self::INFO;

        if ($currentLevel < $configuredLevel) {
            return;
        }

        $timestamp = (new \DateTimeImmutable())->format('Y-m-d H:i:s.v');
        $safeMessage = self::sanitize($message);

        $contextStr = '';
        if (!empty($context)) {
            $safeContext = self::sanitizeContext($context);
            $json = json_encode($safeContext, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json !== false && $json !== '{}') {
                $contextStr = ' ' . $json;
            }
        }

        $formatted = sprintf("[%s] [%s] %s%s\n", $timestamp, strtoupper($level), $safeMessage, $contextStr);

        // Write to STDOUT/STDERR
        if ($currentLevel >= self::ERROR) {
            file_put_contents('php://stderr', $formatted);
        } else {
            file_put_contents('php://stdout', $formatted);
        }

        // Write to log file
        $logPath = Config::get('log_file_path', __DIR__ . '/logs/app.log');
        $dir = dirname($logPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        @file_put_contents($logPath, $formatted, FILE_APPEND | LOCK_EX);
    }

    public static function info(string $message, array $context = []): void
    {
        self::log('INFO', $message, $context);
    }

    public static function warn(string $message, array $context = []): void
    {
        self::log('WARN', $message, $context);
    }

    public static function error(string $message, array $context = []): void
    {
        self::log('ERROR', $message, $context);
    }

    public static function debug(string $message, array $context = []): void
    {
        self::log('DEBUG', $message, $context);
    }

    /**
     * Masks tokens, passwords, hashes, phone numbers and session strings
     */
    public static function sanitize(string $text): string
    {
        $botToken = (string) Config::get('telegram_bot_token', '');
        if ($botToken !== '') {
            $text = str_replace($botToken, '[REDACTED_BOT_TOKEN]', $text);
        }

        $apiHash = (string) Config::get('telegram_api_hash', '');
        if ($apiHash !== '') {
            $text = str_replace($apiHash, '[REDACTED_API_HASH]', $text);
        }

        $phone = (string) Config::get('telegram_user_phone', '');
        if ($phone !== '' && strlen($phone) >= 7) {
            $text = str_replace($phone, '[REDACTED_PHONE]', $text);
        }

        // General Telegram Bot token regex pattern: \d{8,10}:[a-zA-Z0-9_-]{35}
        $text = (string) preg_replace('/(\d{8,10}:[a-zA-Z0-9_-]{30,40})/', '[REDACTED_BOT_TOKEN]', $text);

        // Bot URL path token redaction: /bot<TOKEN>/
        $text = (string) preg_replace('#(/bot)[^/]+(/)#', '$1[REDACTED_BOT_TOKEN]$2', $text);

        // StringSession or auth key base64 pattern (long alphanumeric string)
        $text = (string) preg_replace('/(?<=1[A-Za-z0-9_-]{20})[A-Za-z0-9_-]{100,}/', '[REDACTED_SESSION]', $text);

        return $text;
    }

    private static function sanitizeContext(array $context): array
    {
        $sanitized = [];
        foreach ($context as $k => $v) {
            $lowerKey = strtolower((string) $k);
            if (
                str_contains($lowerKey, 'token') || 
                str_contains($lowerKey, 'hash') || 
                str_contains($lowerKey, 'secret') || 
                str_contains($lowerKey, 'password') ||
                str_contains($lowerKey, 'session') ||
                str_contains($lowerKey, 'phone')
            ) {
                $sanitized[$k] = '[REDACTED]';
            } elseif (is_array($v)) {
                $sanitized[$k] = self::sanitizeContext($v);
            } elseif (is_string($v)) {
                $sanitized[$k] = self::sanitize($v);
            } else {
                $sanitized[$k] = $v;
            }
        }
        return $sanitized;
    }
}

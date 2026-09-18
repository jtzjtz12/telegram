<?php
declare(strict_types=1);

/**
 * Telegram MTProto User Account CLI Authorization Script
 * 
 * Interactively authorizes a standard Telegram user account via MadelineProto.
 * Persists session inside /php-version/data/telegram-session/.
 * Safe against token and secret leakage.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/mtproto.php';

use danog\MadelineProto\API as MadelineProtoAPI;
use danog\MadelineProto\Settings;
use danog\MadelineProto\Logger as MadelineLogger;

$config = Config::load();

$apiId = (int) Config::get('telegram_api_id', 0);
$apiHash = (string) Config::get('telegram_api_hash', '');
$configuredPhone = (string) Config::get('telegram_user_phone', '');
$sessionFile = (string) Config::get('telegram_session_file');
$sessionDir = (string) Config::get('telegram_session_dir', dirname($sessionFile));

echo "============================================================\n";
echo "Telegram MTProto Userbot Authorization (MadelineProto)\n";
echo "============================================================\n";
echo "Session directory: " . $sessionDir . "\n";

// 1. Verify credentials presence
if ($apiId <= 0 || empty($apiHash)) {
    echo "\n[ERROR] TELEGRAM_API_ID or TELEGRAM_API_HASH is missing.\n";
    echo "Please configure TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file.\n";
    exit(1);
}

echo "API ID: " . $apiId . " (Configured)\n";
echo "API Hash: [CONFIGURED - REDACTED]\n";
if (!empty($configuredPhone)) {
    $maskedPhone = substr($configuredPhone, 0, 4) . '***' . substr($configuredPhone, -2);
    echo "Configured Phone: " . $maskedPhone . "\n";
}
echo "------------------------------------------------------------\n";

// 2. Initialize MTProto client
$mtproto = new TelegramMtProto($sessionFile, $apiId, $apiHash);
echo "Connecting to Telegram MTProto network...\n";

if (!$mtproto->connect()) {
    echo "[ERROR] Failed to connect to Telegram MTProto network.\n";
    exit(1);
}

// 3. Check if already authorized
if ($mtproto->isAuthorized()) {
    $self = $mtproto->getSelf();
    echo "\n[OK] Client is ALREADY AUTHORIZED!\n";
    if ($self) {
        echo "User ID:    " . ($self['id'] ?? 'Unknown') . "\n";
        echo "First Name: " . ($self['first_name'] ?? 'Unknown') . "\n";
        if (!empty($self['username'])) {
            echo "Username:   @" . $self['username'] . "\n";
        }
    }
    echo "Session is active in: " . $sessionDir . "\n";
    echo "No further action needed. Re-running authorization is not required.\n";
    echo "============================================================\n";
    exit(0);
}

echo "Current status: NOT AUTHORIZED\n";

// 4. Check if running in an interactive terminal
$isInteractive = function_exists('posix_isatty') ? posix_isatty(STDIN) : (stream_isatty(STDIN) ?? false);

if (!$isInteractive) {
    echo "\n[NOTICE] Non-interactive environment detected.\n";
    echo "Interactive terminal is required to enter your Telegram verification code.\n\n";
    echo "To authenticate, please run the following command in an interactive terminal:\n";
    echo "    cd php-version && php auth.php\n\n";
    echo "Authorization Steps:\n";
    echo "  1. Enter your international phone number (e.g. +1234567890).\n";
    echo "  2. Receive the login code in your official Telegram app.\n";
    echo "  3. Enter the login code in the terminal.\n";
    echo "  4. If 2FA (Two-Factor Authentication) is enabled, enter your password.\n";
    echo "  5. The session will be permanently saved to " . $sessionDir . "\n";
    echo "============================================================\n";
    exit(0);
}

// 5. Interactive CLI Login Flow via MadelineProto
echo "\nStarting interactive Telegram authorization...\n";

$mp = $mtproto->getMadelineProto();
if ($mp === null) {
    echo "[ERROR] MadelineProto instance is not available.\n";
    exit(1);
}

try {
    // Check authorization state
    $authStatus = $mp->getAuthorization();

    if ($authStatus === MadelineProtoAPI::LOGGED_IN) {
        echo "[OK] Successfully authorized!\n";
        exit(0);
    }

    // Interactive stepwise login
    if ($authStatus === MadelineProtoAPI::NOT_LOGGED_IN) {
        $phoneToUse = '';
        if (!empty($configuredPhone)) {
            $masked = substr($configuredPhone, 0, 4) . '***' . substr($configuredPhone, -2);
            echo "Use configured phone number {$masked}? [Y/n]: ";
            $answer = trim((string) fgets(STDIN));
            if ($answer === '' || strtolower($answer) === 'y') {
                $phoneToUse = $configuredPhone;
            }
        }

        if (empty($phoneToUse)) {
            echo "Enter your phone number in international format (e.g. +1234567890): ";
            $phoneToUse = trim((string) fgets(STDIN));
        }

        if (empty($phoneToUse)) {
            echo "[ERROR] Phone number cannot be empty.\n";
            exit(1);
        }

        echo "Sending login code to Telegram app for this number...\n";
        $mp->phoneLogin($phoneToUse);
        $authStatus = $mp->getAuthorization();
    }

    if ($authStatus === MadelineProtoAPI::WAITING_CODE) {
        echo "Enter the login code you received in Telegram: ";
        $code = trim((string) fgets(STDIN));
        if (empty($code)) {
            echo "[ERROR] Code cannot be empty.\n";
            exit(1);
        }

        $res = $mp->completePhoneLogin($code);
        $authStatus = $mp->getAuthorization();
    }

    if ($authStatus === MadelineProtoAPI::WAITING_PASSWORD) {
        echo "Account is protected by 2FA. Enter your Two-Factor Authentication password: ";
        $password = trim((string) fgets(STDIN));
        if (empty($password)) {
            echo "[ERROR] Password cannot be empty.\n";
            exit(1);
        }

        $res = $mp->complete2faLogin($password);
        $authStatus = $mp->getAuthorization();
    }

    if ($authStatus === MadelineProtoAPI::LOGGED_IN) {
        echo "\n[SUCCESS] MTProto authorization successful!\n";
        $self = $mp->getSelf();
        if (is_array($self)) {
            echo "Authorized as: " . ($self['first_name'] ?? '') . " " . ($self['last_name'] ?? '');
            if (!empty($self['username'])) {
                echo " (@" . $self['username'] . ")";
            }
            echo " (ID: " . ($self['id'] ?? 0) . ")\n";
        }
        echo "Session saved successfully in: " . $sessionDir . "\n";
        echo "============================================================\n";
        exit(0);
    } else {
        echo "\n[WARNING] Authorization ended with status code: {$authStatus}\n";
        exit(1);
    }
} catch (\Throwable $e) {
    Logger::error("Authorization error: " . $e->getMessage());
    echo "\n[ERROR] Authorization failed: " . $e->getMessage() . "\n";
    exit(1);
}

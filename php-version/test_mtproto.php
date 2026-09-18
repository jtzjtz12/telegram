<?php
declare(strict_types=1);

/**
 * MTProto Userbot Diagnostic & Test Script
 * 
 * Tests:
 * 1. Configuration loading (API ID, Hash, Bot Username).
 * 2. Session directory & files check in /php-version/data/telegram-session/.
 * 3. MTProto network connection via MadelineProto.
 * 4. Authorization check:
 *    - If NOT authorized: outputs clean info and exits 0 (diagnostic success).
 * 5. If authorized:
 *    - Outputs self user info (ID, username, first_name).
 *    - Looks up @speech_transcriber_bot and tests availability.
 *    - Handles YOU_BLOCKED_USER if blocked.
 * 6. Optional flag: php test_mtproto.php --send-test path/to/voice.oga
 *    - Sends voice note, waits for transcription, outputs result.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/mtproto.php';

$config = Config::load();

echo "============================================================\n";
echo "Telegram MTProto Diagnostic & Test Runner\n";
echo "============================================================\n";

// Parse CLI options
$sendTestFile = null;
global $argv;
if (isset($argv) && is_array($argv)) {
    for ($i = 1; $i < count($argv); $i++) {
        if ($argv[$i] === '--send-test' && isset($argv[$i + 1])) {
            $sendTestFile = $argv[$i + 1];
            $i++;
        } elseif (str_starts_with($argv[$i], '--send-test=')) {
            $sendTestFile = substr($argv[$i], 12);
        }
    }
}

// 1. Configuration check
$apiId = (int) Config::get('telegram_api_id', 0);
$apiHash = (string) Config::get('telegram_api_hash', '');
$botUsername = (string) Config::get('transcriber_bot_username', 'speech_transcriber_bot');
$sessionFile = (string) Config::get('telegram_session_file');
$sessionDir = (string) Config::get('telegram_session_dir', dirname($sessionFile));
$timeoutSeconds = (int) Config::get('transcriber_timeout_seconds', 180);

echo "[CHECK 1/5] Configuration:\n";
echo "  - Telegram API ID:        " . ($apiId > 0 ? "{$apiId} (Valid)" : "[MISSING / INVALID]") . "\n";
echo "  - Telegram API Hash:      " . (!empty($apiHash) ? "[CONFIGURED - REDACTED]" : "[MISSING]") . "\n";
echo "  - Target Transcriber Bot: @" . ltrim($botUsername, '@') . "\n";
echo "  - Transcriber Timeout:    {$timeoutSeconds}s\n";

if ($apiId <= 0 || empty($apiHash)) {
    echo "\n[ERROR] MTProto credentials missing. Configure TELEGRAM_API_ID and TELEGRAM_API_HASH.\n";
    exit(1);
}

// 2. Session presence check
echo "\n[CHECK 2/5] Session Storage:\n";
echo "  - Session Directory:      {$sessionDir}\n";
echo "  - Directory Exists:       " . (is_dir($sessionDir) ? "[YES]" : "[NO]") . "\n";
echo "  - Session Target:         {$sessionFile}\n";

$sessionExists = file_exists($sessionFile) || is_dir($sessionFile);
echo "  - Session Exists:         " . ($sessionExists ? "[YES]" : "[NO - Not initialized yet]") . "\n";

// 3. Connect to MTProto
echo "\n[CHECK 3/5] MTProto Connection:\n";
$mtproto = new TelegramMtProto($sessionFile, $apiId, $apiHash, $botUsername);

$connected = $mtproto->connect();
if (!$connected) {
    echo "  - Connection Status:      [FAILED]\n";
    echo "\n[ERROR] Could not establish connection to Telegram MTProto network.\n";
    exit(1);
}
echo "  - Connection Status:      [CONNECTED]\n";

// 4. Check authorization
echo "\n[CHECK 4/5] Authorization Status:\n";
$isAuthorized = $mtproto->isAuthorized();

if (!$isAuthorized) {
    echo "  - Authorized:             [NO]\n";
    echo "\n============================================================\n";
    echo "MTProto session is not authorized. Run: php auth.php\n";
    echo "============================================================\n";

    if ($sendTestFile !== null) {
        echo "[ERROR] Cannot execute --send-test: session is not authorized.\n";
        exit(1);
    }

    // Normal diagnostic exit code 0 when testing without auth
    exit(0);
}

echo "  - Authorized:             [YES]\n";
$self = $mtproto->getSelf();
if ($self) {
    echo "  - Account ID:             " . ($self['id'] ?? 0) . "\n";
    echo "  - First Name:             " . ($self['first_name'] ?? '') . "\n";
    if (!empty($self['username'])) {
        echo "  - Username:               @" . $self['username'] . "\n";
    }
}

// 5. Check target transcriber bot
echo "\n[CHECK 5/5] Transcriber Bot Availability:\n";
$botCheck = $mtproto->getTranscriberBot();

if (!empty($botCheck['blocked'])) {
    echo "  - Status:                 [BLOCKED]\n";
    echo "  - Message:                MTProto account has blocked the transcriber bot. Unblock @{$botUsername} in Telegram.\n";
} elseif ($botCheck['ok']) {
    echo "  - Status:                 [AVAILABLE]\n";
    echo "  - Bot ID:                 " . ($botCheck['id'] ?? 0) . "\n";
    echo "  - Bot Username:           @" . ($botCheck['username'] ?? $botUsername) . "\n";
    echo "  - Bot First Name:         " . ($botCheck['first_name'] ?? '') . "\n";
} else {
    echo "  - Status:                 [UNAVAILABLE / ERROR]\n";
    echo "  - Error:                  " . ($botCheck['error'] ?? 'Unknown error') . "\n";
}

// 6. Optional: Send test audio if requested
if ($sendTestFile !== null) {
    echo "\n============================================================\n";
    echo "Testing Voice Note Sending (--send-test)\n";
    echo "============================================================\n";
    echo "Target Bot:  @" . ltrim($botUsername, '@') . "\n";
    echo "Audio File:  {$sendTestFile}\n";

    if (!file_exists($sendTestFile)) {
        echo "[ERROR] Specified test file does not exist: {$sendTestFile}\n";
        exit(1);
    }

    echo "Sending voice message via MTProto...\n";
    $sendResult = $mtproto->sendVoice($sendTestFile);

    if (!$sendResult['ok']) {
        echo "[ERROR] Failed to send voice message: " . ($sendResult['error'] ?? 'Unknown error') . "\n";
        exit(1);
    }

    $sentMsgId = $sendResult['message_id'];
    echo "[OK] Voice message sent successfully (message_id={$sentMsgId}).\n";
    echo "Waiting for transcription from @{$botUsername} (timeout: {$timeoutSeconds}s)...\n";

    $transcriptionResult = $mtproto->waitForTranscription(
        $sentMsgId,
        $timeoutSeconds,
        function (array $progress) {
            echo "  -> Progress update [{$progress['elapsed_sec']}s]: {$progress['text']}\n";
        }
    );

    if ($transcriptionResult['ok']) {
        echo "\n[SUCCESS] Transcription received in {$transcriptionResult['wait_time_sec']}s:\n";
        echo "------------------------------------------------------------\n";
        echo $transcriptionResult['transcription'] . "\n";
        echo "------------------------------------------------------------\n";
    } else {
        echo "\n[FAILURE] Transcription failed: " . ($transcriptionResult['error'] ?? 'Timeout') . "\n";
        exit(1);
    }
}

echo "\n============================================================\n";
echo "All diagnostic checks completed successfully!\n";
echo "============================================================\n";
exit(0);

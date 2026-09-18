<?php
declare(strict_types=1);

/**
 * Telegram Bot API Diagnostic Test Script
 * 
 * Safely tests:
 * 1. Environment & configuration loading.
 * 2. Telegram Bot API getMe().
 * 3. Telegram Bot API deleteWebhook(drop_pending_updates=false).
 * 4. Telegram Bot API getUpdates(offset=0, limit=5, timeout=0).
 * 5. SQLite database connection, table structure, and duplicate protection.
 * 
 * Exits safely after running all checks — DOES NOT run an infinite polling loop.
 */

namespace Transcriber;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/bot_api.php';
require_once __DIR__ . '/poll.php';

$poller = new BotPoller();
$poller->runDiagnostics();

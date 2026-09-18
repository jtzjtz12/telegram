# Telegram Voice Transcriber — PHP Version

PHP-реализация сервиса автоматической транскрибации голосовых сообщений из Telegram через Telegram Bot API и MTProto (MadelineProto) с базой данных SQLite.

---

## 1. Системные требования

- **PHP 8.2+** (CLI)
- **Расширения PHP**: `pdo_sqlite`, `curl`, `mbstring`, `xml`, `fileinfo`
- **Composer 2.x**

---

## 2. Структура проекта (`/php-version`)

```text
php-version/
├── composer.json       # Зависимости проекта (MadelineProto, Guzzle, Dotenv)
├── composer.lock       # Зафиксированные версии пакетов
├── .env.example        # Шаблон конфигурации переменных окружения
├── config.php          # Загрузка .env и доступ к параметрам (Transcriber\Config)
├── logger.php          # Структурированный логгер с маскировкой секретов и токенов
├── db.php              # Подключение к SQLite (PDO) и операции с очередью jobs
├── bot_api.php         # Клиент Telegram Bot API (Guzzle/cURL с обработкой ошибок)
├── poll.php            # Long Polling сервис приёма голосовых сообщений + режим диагностики
├── test_bot.php        # Безопасный скрипт экспресс-тестирования Bot API и БД
├── mtproto.php         # Клиент Telegram MTProto на MadelineProto (Transcriber\TelegramMtProto)
├── auth.php            # Скрипт интерактивной CLI-авторизации пользователя в MTProto
├── test_mtproto.php    # Безопасный скрипт экспресс-диагностики MTProto и тестовой отправки
├── worker.php          # Скелет воркера транскрибации (следующий этап)
├── data/
│   ├── audio/          # Каталог для загрузки аудиофайлов (.oga, .ogg)
│   ├── telegram-session/ # Каталог постоянного хранения MTProto-сессии (MadelineProto)
│   └── transcriber.db  # База данных SQLite (совместима со схемой Node.js)
├── logs/
│   ├── app.log         # Файл общего журнала работы
│   └── madeline.log    # Логи MadelineProto
└── README.md           # Документация по установке, тестированию и запуску
```

---

## 3. Установка зависимостей

Перейдите в каталог `php-version` и выполните установку пакетов Composer:

```bash
cd php-version
composer install
```

---

## 4. Настройка переменных окружения (`.env`)

Создайте файл `.env` на основе шаблона:

```bash
cp .env.example .env
```

Основные параметры конфигурации:

```ini
# Окружение
APP_ENV=development

# Telegram Bot API (для приёма голосовых и отправки ответов)
TELEGRAM_BOT_TOKEN=123456789:ABCDefghIJKlmNoPQRsTUVwxyZ
BOT_POLL_TIMEOUT=20

# SQLite и хранилище файлов
DATABASE_PATH=data/transcriber.db
AUDIO_DIR=data/audio
LOG_FILE_PATH=logs/app.log
LOG_LEVEL=INFO

# Таймауты транскрибации
TRANSCRIBER_TIMEOUT_SECONDS=180
TRANSCRIBER_POLL_INTERVAL_MS=1000

# MTProto Userbot (для следующего этапа)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_USER_PHONE=
TELEGRAM_SESSION_FILE=data/session.madeline
TRANSCRIBER_BOT_USERNAME=speech_transcriber_bot
```

> **Безопасность:** реальные токены и секреты не должны добавляться в систему контроля версий. Логгер автоматически маскирует токены бота и хеши в выводе.

---

## 5. Запуск безопасного тестового режима

Для быстрой проверки подключения к Telegram Bot API и базы данных без запуска бесконечного цикла используйте тестовый режим:

```bash
php test_bot.php
```

или

```bash
php poll.php --test
```

**Что проверяет тестовый режим:**
1. Наличие и валидность `TELEGRAM_BOT_TOKEN` в `.env`.
2. Подключение к Bot API через `getMe()` (выводит username и ID бота).
3. Корректность снятия вебхука через `deleteWebhook(drop_pending_updates=false)`.
4. Запрос текущих обновлений через `getUpdates(offset=0, limit=5, timeout=0)`.
5. Доступ к SQLite БД, наличие таблицы `jobs` и индексов.
6. Работу механизма защиты от дубликатов сообщений (`telegram_chat_id + telegram_message_id`).

---

## 6. Запуск Telegram Bot API Long Polling

Запуск основного демона long polling:

```bash
php poll.php
```

**Логика работы сервиса polling:**
- Перед стартом цикла очищает вебхук вызовом `deleteWebhook(drop_pending_updates=false)`.
- Выполняет постоянный опрос Telegram Bot API методом `getUpdates` с таймаутом ожидания 20 секунд.
- Корректно инкрементирует `offset` (`max(offset, update_id + 1)`), исключая повторный приём одних и тех же update.
- Игнорирует текстовые, сервисные и прочие не-аудио сообщения.
- При обнаружении голосового сообщения (`voice`) или аудиозаписи (`audio`):
  1. Извлекает `file_id`.
  2. Запрашивает путь к файлу через `getFile()`.
  3. Скачивает аудиофайл в директорию `data/audio/` (формат: `voice_<timestamp>_<hash>.oga`).
  4. Проверяет наличие дубликата в таблице `jobs` по паре `telegram_chat_id` и `telegram_message_id`.
  5. Создаёт новую запись в таблице `jobs` со статусом `pending`.
- Поддерживает безопасное завершение при сигналах `SIGINT` (Ctrl+C) и `SIGTERM`.

---

## 7. Реализованные методы Telegram Bot API (`bot_api.php`)

Класс `Transcriber\TelegramBotApi` полностью реализован с использованием Guzzle (и fallback на cURL):

| Метод | Назначение | Особенности реализации |
|---|---|---|
| `getMe()` | Проверка подлинности бота | Возвращает структурированный массив данных бота |
| `deleteWebhook($dropPendingUpdates)` | Удаление вебхука | Очищает вебхук перед началом long polling |
| `getUpdates($offset, $limit, $timeout)` | Получение обновлений | HTTP-таймаут адаптируется под время ожидания polling |
| `getFile($fileId)` | Получение метаданных файла | Возвращает `file_path` и размер файла на серверах Telegram |
| `downloadFile($remotePath, $localSavePath)` | Загрузка файла на диск | Потоковое сохранение в `data/audio/`, проверка целостности |
| `sendMessage($chatId, $text, $replyToId)` | Отправка текстового сообщения | Двухэтапная отправка: сначала с `reply_to_message_id`, при отказе — fallback прямой отправкой |
| `deleteMessage($chatId, $messageId)` | Удаление сообщения в чате | Удаление голосового сообщения после успешной обработки |

---

## 8. MTProto Userbot (`mtproto.php`, `auth.php`, `test_mtproto.php`)

Реализован слой взаимодействия с Telegram через MTProto (библиотека `danog/madelineproto`):

- **`Transcriber\TelegramMtProto` (`mtproto.php`)**:
  - `connect()`: подключение к серверам Telegram по MTProto.
  - `isAuthorized()`: проверка наличия активной авторизованной сессии.
  - `getSelf()`: получение информации об авторизованном аккаунте (ID, username, имя).
  - `getTranscriberBot()`: поиск `@speech_transcriber_bot` с обработкой ошибки блокировки (`YOU_BLOCKED_USER`).
  - `sendVoice($filePath)`: отправка голосового сообщения боту-транскрибатору.
  - `waitForTranscription($messageId, $timeout, $onProgress)`: ожидание ответа с автоматической фильтрацией промежуточных статусов ("Обработка...", "Распознаю...", "Конвертирую...").
  - `isIntermediateStatus($text)`: определение промежуточных маркеров.

### Авторизация MTProto аккаунта (`auth.php`)

Для интерактивной авторизации пользователя:

```bash
cd php-version
php auth.php
```

Скрипт запросит номер телефона (или предложит использовать `TELEGRAM_USER_PHONE`), пришлёт код авторизации в официальное приложение Telegram и при необходимости запросит пароль двухфакторной аутентификации (2FA). Сессия сохраняется в `data/telegram-session/`.

### Экспресс-диагностика MTProto (`test_mtproto.php`)

Проверка подключения и статуса авторизации без отправки сообщений:

```bash
php test_mtproto.php
```

Отправка тестового аудиофайла и получение транскрибации (при наличии авторизованной сессии):

```bash
php test_mtproto.php --send-test data/audio/sample.oga
```

---

## 9. Планируемые следующие шаги

1. **Воркер транскрибации (`worker.php`)**:
   - Фоновая выборка задач со статусом `pending` из SQLite.
   - Отправка голосового файла через MTProto в `@speech_transcriber_bot`.
   - Ожидание текстового ответа от транскрибера с контролем таймаута (`TRANSCRIBER_TIMEOUT_SECONDS`).
   - Отправка готового чистого текста обратно в исходный чат через `TelegramBotApi::sendMessage()`.
   - Удаление исходного голосового сообщения через `TelegramBotApi::deleteMessage()` после успешной доставки текста.
   - Обновление статуса задачи в SQLite (`completed` / `failed`).

# Telegram Voice Transcriber — Backend Skeleton (Этап 1)

Серверное Node.js / TypeScript приложение для будущей цепочки расшифровки голосовых сообщений из Telegram:
1. Получение голосового сообщения через обычного Telegram Bot API бота.
2. Пересылка аудио через отдельный пользовательский аккаунт Telegram по MTProto в бота `@speech_transcriber_bot`.
3. Получение текстовой расшифровки от `@speech_transcriber_bot`.
4. Возврат распознанного текста пользователю в Telegram.

> **Текущий этап (Этап 1)**: Реализован стабильный backend-каркас, SQLite-хранилище, структурированное логирование и веб-интерфейс администратора. Логика MTProto и Telegram Bot API будет подключена на следующем этапе.

---

## Стек технологий

* **Runtime**: Node.js (v20+ / v22+)
* **Язык**: TypeScript
* **HTTP-сервер**: Express
* **База данных**: SQLite (встраиваемый LibSQL движок с локальным хранением файла `.db`)
* **Конфигурация**: `dotenv` (`.env`)
* **Логирование**: Структурированные логи с уровнями `debug`, `info`, `warn`, `error` (консоль + файл `logs/app.log`)
* **Веб-интерфейс администратора**: React + Vite + Tailwind CSS с авторизацией

---

## Структура файлов проекта

```
├── .env.example            # Шаблон переменных окружения (секреты и настройки)
├── .gitignore              # Игнорирование данных SQLite, логов и node_modules
├── Dockerfile              # Мультистейдж сборка Docker-контейнера
├── docker-compose.yml      # Конфигурация для запуска в Docker Compose
├── package.json            # Зависимости и npm-скрипты
├── tsconfig.json           # Конфигурация TypeScript
├── README.md               # Документация проекта
├── data/                   # Директория постоянного хранения SQLite базы данных
│   └── transcriber.db
├── logs/                   # Директория ротации и записи structured logs
│   └── app.log
├── src/
│   ├── server.ts           # Главный входной файл сервера Express
│   ├── config.ts           # Валидация и загрузка настроек из .env
│   ├── database.ts         # Инициализация SQLite, схема таблицы jobs, CRUD методы
│   ├── logger.ts           # Структурированный логгер (запись в файл и память)
│   ├── types.ts            # Общие TypeScript интерфейсы (Job, JobStatus, StatusData)
│   ├── routes/
│   │   ├── health.ts       # GET /health
│   │   ├── status.ts       # GET /api/status (состояние приложения, БД, воркера)
│   │   └── jobs.ts         # GET /api/jobs, POST /api/jobs/test
│   ├── web/
│   │   └── index.ts        # Авторизация и маршруты для админ-панели
│   ├── components/         # Компоненты веб-интерфейса администратора
│   │   ├── StatusCards.tsx
│   │   ├── JobsTable.tsx
│   │   ├── ErrorsPanel.tsx
│   │   ├── LogsViewer.tsx
│   │   ├── CreateJobModal.tsx
│   │   └── LoginModal.tsx
│   ├── App.tsx             # Главный интерфейс панели администратора
│   ├── main.tsx            # Клиентский входной модуль
│   └── index.css           # Стилизация Tailwind CSS
```

---

## Схема SQLite таблицы `jobs`

Таблица создается автоматически при первом старте сервера:

| Поле | Тип | Описание |
| :--- | :--- | :--- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Уникальный номер задачи |
| `telegram_chat_id` | `TEXT` | ID Telegram чата, откуда пришло сообщение |
| `telegram_message_id`| `INTEGER` | ID исходного сообщения с аудио |
| `sender_user_id` | `TEXT` | ID отправителя сообщения |
| `original_file_id` | `TEXT` | Telegram file_id голосового файла |
| `local_file_path` | `TEXT` | Путь к сохраненному аудиофайлу (.ogg) |
| `status` | `TEXT` | Статус задачи (`CHECK` ограничение) |
| `created_at` | `TEXT` | ISO дата создания задачи |
| `started_at` | `TEXT` | ISO дата взятия в обработку |
| `completed_at` | `TEXT` | ISO дата завершения или ошибки |
| `transcription` | `TEXT` | Полученный текст расшифровки |
| `error` | `TEXT` | Текст ошибки при сбое |
| `transcriber_message_id` | `INTEGER` | ID сообщения в диалоге с @speech_transcriber_bot |
| `attempts` | `INTEGER` | Количество попыток обработки (default 0) |

### Допустимые статусы:
* `pending` — Новая задача в очереди.
* `processing` — Аудио скачивается / готовится к передаче.
* `waiting_transcription` — Сообщение передано в `@speech_transcriber_bot` по MTProto.
* `completed` — Текст получен и готов к отправке пользователю.
* `failed` — Произошла ошибка (таймаут, сбой аудио, ошибка сети).

---

## API Эндпоинты

### 1. Healthcheck
* **Запрос:** `GET /health`
* **Ответ:**
  ```json
  { "status": "ok" }
  ```

### 2. Состояние системы
* **Запрос:** `GET /api/status`
* **Ответ:** Детальная информация о:
  * **Application:** статус (`healthy`), uptime, версия Node.js, потребление памяти (RSS, Heap);
  * **Database:** статус подключения SQLite, путь к файлу БД, общее число задач, счетчики по статусам;
  * **Worker:** текущее состояние воркера очереди и готовность к MTProto интеграции.

### 3. Список задач
* **Запрос:** `GET /api/jobs`
* **Параметры:** `?limit=50&status=pending`
* **Ответ:** Список последних задач из таблицы `jobs` с метаданными.

### 4. Тестовое создание задачи
* **Запрос:** `POST /api/jobs/test`
* **Тело:** JSON с полями задачи (все поля опциональны с автогенерацией значений).

---

## Веб-интерфейс администратора

Доступен по адресу `http://localhost:3000/`.

Функционал панели:
* Отображение состояния приложения, БД и воркера в реальном времени.
* Интерактивные фильтры по статусам (`pending`, `processing`, `waiting_transcription`, `completed`, `failed`).
* Таблица последних задач с просмотром всех 14 колонок SQLite.
* Раздел ошибок с детализацией сбойных задач и системных исключений.
* Просмотр структурированных логов с фильтрацией по уровням (`info`, `warn`, `error`).
* Авторизация администратора по `ADMIN_USERNAME` и `ADMIN_PASSWORD`.

---

## Настройка переменных окружения

Скопируйте пример файла конфигурации:
```bash
cp .env.example .env
```

Заполните учетные данные администратора и пути:
```ini
PORT=3000
NODE_ENV=development

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password_here

DATABASE_PATH=./data/transcriber.db
LOG_LEVEL=info
LOG_FILE_PATH=./logs/app.log
```

---

## Инструкции запуска

### Вариант 1: Запуск без Docker (Node.js)

1. **Установка зависимостей:**
   ```bash
   npm install
   ```

2. **Запуск в режиме разработки (с Live Reload и Vite):**
   ```bash
   npm run dev
   ```
   Сервер запустится на `http://localhost:3000`.

3. **Сборка проекта:**
   ```bash
   npm run build
   ```
   Скомпилирует клиентские ассеты в `dist/` и бандл сервера в `dist/server.cjs`.

4. **Запуск собранного проекта (Production):**
   ```bash
   npm start
   ```

---

### Вариант 2: Запуск с Docker & Docker Compose

1. **Запуск контейнера:**
   ```bash
   docker compose up -d --build
   ```

2. **Просмотр логов контейнера:**
   ```bash
   docker compose logs -f
   ```

3. **Остановка:**
   ```bash
   docker compose down
   ```

Данные SQLite сохраняются в директорию `./data` на хосте, а логи — в `./logs`.

# Telegram ComfyUI Mini App Bot

Telegram-бот с mini app для генерации изображений через ComfyUI.

Внутри:

- Backend на Node.js/Express.
- Telegram webhook-бот: команда `/start` присылает кнопку mini app.
- Frontend на React/Vite.
- Генерация через ComfyUI `/prompt`.
- Очередь генераций с лимитами на пользователя и глобальной конкурентностью.
- Прогресс через WebSocket ComfyUI → WebSocket mini app.
- История генераций с картинками, параметрами, избранным, поиском и копированием параметров обратно в форму.
- Пресеты генерации из JSON-файла.
- Checkpoint/sampler/scheduler/LoRA подтягиваются из ComfyUI `/object_info`, если ComfyUI доступен.
- Workflow-адаптеры: текущая реализация содержит `sd15-text2img`, но структура готова под SDXL/Flux/img2img/upscale.
- Конфиги для Cloudflare Named Tunnel.
- Опциональный автостарт `cloudflared` вместе с backend и остановка при завершении Node-процесса.

## 1. Подготовка

Нужны:

- Node.js 20+.
- Запущенный ComfyUI.
- Telegram bot token от BotFather.
- HTTPS-домен через Cloudflare Named Tunnel, например `https://your-bot.example.com`.

Скопируй конфиг:

```bash
cp config.example.yaml config.yaml
```

Заполни минимум:

```yaml
server:
  publicBaseUrl: https://your-bot.example.com
  miniAppUrl: https://your-bot.example.com

telegram:
  botToken: "123456:ABC..."
  webhookSecret: "long-random-secret"

comfy:
  httpUrl: http://127.0.0.1:8188
  wsUrl: ws://127.0.0.1:8188/ws
```

Если backend запущен в Docker, а ComfyUI на хост-машине, обычно удобнее так:

```yaml
comfy:
  httpUrl: http://host.docker.internal:8188
  wsUrl: ws://host.docker.internal:8188/ws
```

## 2. Установка и запуск без Docker

```bash
npm install
npm run build
npm start
```

Backend поднимется на `http://127.0.0.1:8080`.

Поставь Telegram webhook:

```bash
npm run set-webhook
```

Проверь:

```bash
curl http://127.0.0.1:8080/api/health
```

## 3. Запуск через Docker Compose

```bash
docker compose up -d --build
```

После этого поставь webhook. Можно выполнить внутри контейнера:

```bash
docker compose exec tg-comfy-miniapp npm run set-webhook
```

## 4. Очередь генераций

Параметры очереди лежат в `config.yaml`:

```yaml
jobs:
  maxConcurrentGlobal: 1
  maxQueuePerUser: 3
  allowInterruptRunning: false
```

`maxConcurrentGlobal` определяет, сколько генераций backend одновременно отправляет в ComfyUI.

`maxQueuePerUser` ограничивает количество ожидающих задач одного Telegram-пользователя.

`allowInterruptRunning` по умолчанию выключен, потому что ComfyUI `/interrupt` обычно глобальный: он может остановить не только задачу этого mini app, но и чужую ручную генерацию в том же ComfyUI.

## 5. Пресеты

Пресеты лежат в JSON-файле:

```yaml
presets:
  file: ./presets/default.json
```

Формат:

```json
{
  "presets": [
    {
      "id": "fast-draft",
      "name": "Быстрый черновик",
      "description": "Меньше шагов, удобно быстро проверять промпт.",
      "settings": {
        "workflowType": "sd15-text2img",
        "width": 512,
        "height": 512,
        "steps": 12,
        "cfg": 6,
        "seed": -1
      }
    }
  ]
}
```

Настройки пресета накладываются поверх `defaultSettings` backend-а.

## 6. Как работает workflow

По умолчанию используется файл:

```yaml
comfy:
  workflowFile: ./workflows/sd15-basic.json
  defaultWorkflowType: sd15-text2img
```

Это простой API workflow:

`CheckpointLoaderSimple → CLIPTextEncode → EmptyLatentImage → KSampler → VAEDecode → SaveImage`

LoRA добавляются динамически через `LoraLoader` между checkpoint и CLIP/KSampler.

Текущий адаптер `sd15-text2img` ожидает наличие этих node-классов:

- `CheckpointLoaderSimple`
- `CLIPTextEncode` — два узла: positive и negative
- `EmptyLatentImage`
- `KSampler`
- `SaveImage`

Для SDXL, Flux, img2img, inpaint, upscale или ControlNet добавляй новый адаптер в `backend/src/comfy/workflows/` и регистрируй его в `backend/src/comfy/workflowBuilder.js`.

## 7. Авторизация Telegram Mini App

Все API-запросы mini app отправляют заголовок:

```http
X-Telegram-Init-Data: <Telegram.WebApp.initData>
```

Backend валидирует подпись `initData` через bot token. Для локальной отладки можно временно поставить:

```yaml
telegram:
  enforceAuth: false
```

Не оставляй это в проде.

Новые изображения отдаются через авторизованный endpoint `/api/history/:id/images/:filename`. Старый `/generated` оставлен только для обратной совместимости с уже сохранённой историей.

## 8. Ограничение доступа

Можно разрешить только конкретные Telegram user ID:

```yaml
telegram:
  allowedUserIds:
    - 123456789
    - 987654321
```

Пустой список означает: разрешён любой пользователь, который открыл mini app через бота.

## 9. Где лежит история

История и скачанные результаты сохраняются здесь:

```text
backend/data/db.json
backend/data/generated/
```

Backend держит актуальное состояние в памяти и пишет `db.json` с небольшим debounce, чтобы progress-события не долбили файл на каждый процент.

Для более серьёзного продакшена следующий естественный шаг — заменить `JsonGenerationRepository` на SQLite-репозиторий с тем же интерфейсом.

## 10. Cloudflare Named Tunnel

Локальный вариант:

```bash
cloudflared tunnel login
cloudflared tunnel create tg-comfy-miniapp
cloudflared tunnel route dns tg-comfy-miniapp your-bot.example.com
```

Скопируй пример:

```bash
cp cloudflared/config.yml.example cloudflared/config.yml
```

Впиши `tunnel`, `credentials-file`, `hostname`. Для ручного запуска tunnel:

```bash
cloudflared tunnel --config cloudflared/config.yml run tg-comfy-miniapp
```

### Автостарт cloudflared вместе с ботом

Можно сделать так, чтобы `npm start` запускал и backend, и `cloudflared`. Для этого в `config.yaml` включи:

```yaml
cloudflare:
  autoStart: true
  executable: cloudflared
  configFile: ./cloudflared/config.yml
  tunnelName: tg-comfy-miniapp
  hostname: your-bot.example.com
  logLevel: info
  restartOnExit: true
  restartDelayMs: 5000
```

На Windows, если `cloudflared` не лежит в `PATH`, укажи полный путь:

```yaml
cloudflare:
  executable: C:\Programs\cloudflared\cloudflared.exe
```

После этого обычный запуск:

```bash
npm start
```

В консоли должны появиться строки с префиксом `[cloudflared]`. При `Ctrl+C` backend отправит `cloudflared` сигнал остановки.

Если запускаешь `cloudflared` внутри `docker-compose`, используй:

```bash
cp cloudflared/config.docker.yml.example cloudflared/config.yml
```

И раскомментируй сервис `cloudflared` в `docker-compose.yml`. Для Docker обычно не нужно включать `cloudflare.autoStart`, потому что tunnel лучше держать отдельным сервисом compose.

## 11. Частые проблемы

### Telegram не открывает mini app

Проверь, что `server.publicBaseUrl` и `server.miniAppUrl` начинаются с `https://`. Telegram Web Apps требуют HTTPS URL.

### ComfyUI недоступен из Docker

Проверь `comfy.httpUrl` и `comfy.wsUrl`. Если ComfyUI запущен на хосте, используй `host.docker.internal` и оставь `extra_hosts` в `docker-compose.yml`.

### Списки моделей пустые

Backend пытается прочитать `/object_info` у ComfyUI. Если не получилось, используются fallback-значения из `config.yaml`.

### Генерация падает из-за checkpoint

Имя checkpoint в форме должно совпадать с файлом в ComfyUI. Открой `/api/comfy/resources` после авторизации или посмотри список в mini app.

## 12. Быстрая диагностика, если бот молчит

Важно: этот бот работает через Telegram webhook, не через long polling. Поэтому `npm start` только запускает backend; после этого webhook должен быть установлен командой:

```bash
npm run set-webhook
```

Проверить всю цепочку можно так:

```bash
npm run check-setup
```

Если запуск через Docker:

```bash
docker compose logs -f tg-comfy-miniapp
docker compose exec tg-comfy-miniapp npm run check-setup
```

Что должно быть в норме:

- `local backend /api/health` возвращает `200`.
- `public backend /api/health` возвращает `200` через твой Cloudflare HTTPS-домен.
- `telegram getWebhookInfo` показывает URL вида `https://твой-домен/telegram/webhook`.
- В `last_error_message` у Telegram пусто.
- После сообщения `/start` в логах backend появляется строка `[telegram] update=... text="/start"`.

Если `public backend /api/health` не открывается, проблема почти точно в Cloudflare Tunnel/домене/ingress.
Если включён `cloudflare.autoStart`, проверь, что после `npm start` в консоли есть строки `[cloudflared]`. Если там `failed to start`, укажи полный путь к `cloudflared.exe` в `cloudflare.executable`.
Если health открывается, но в логах нет `[telegram] update=...`, проблема в webhook URL или `npm run set-webhook` не был выполнен после смены домена.
Если лог есть, но кнопка не приходит, смотри ошибку Telegram API в логах backend.

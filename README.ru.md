<p align="right">
  <strong>Русский</strong> · <a href="./README.md">English</a>
</p>

<h1 align="center">WispLoc</h1>

<p align="center">
  <strong>Локальный web UI для обработки длинных аудио и видео.</strong>
</p>

<p align="center">
  <img alt="Local First" src="https://img.shields.io/badge/Local%20First-000000?style=for-the-badge&logo=homeassistant&logoColor=white">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-tested-111111?style=for-the-badge&logo=linux&logoColor=white">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-in%20progress-111111?style=for-the-badge&logo=windows&logoColor=white">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-in%20progress-111111?style=for-the-badge&logo=apple&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-1F1F1F?style=for-the-badge&logo=typescript&logoColor=3178C6">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white">
  <img alt="HeroUI" src="https://img.shields.io/badge/HeroUI-000000?style=for-the-badge">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white">
  <img alt="React Router" src="https://img.shields.io/badge/React_Router-CA4245?style=for-the-badge&logo=reactrouter&logoColor=white">
  <img alt="TanStack Query" src="https://img.shields.io/badge/TanStack_Query-FF4154?style=for-the-badge&logo=reactquery&logoColor=white">
  <img alt="Zustand" src="https://img.shields.io/badge/Zustand-443E38?style=for-the-badge">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white">
  <img alt="FFmpeg" src="https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white">
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-qwen3%3A4b-000000?style=for-the-badge">
  <img alt="Whisper" src="https://img.shields.io/badge/Whisper.cpp-ggml--base-000000?style=for-the-badge">
  <img alt="GitHub Issues" src="https://img.shields.io/badge/GitHub_Issues-181717?style=for-the-badge&logo=github&logoColor=white">
  <a href="https://github.com/StaburovAlexey/WispLoc"><img alt="GitHub stars" src="https://img.shields.io/github/stars/StaburovAlexey/WispLoc?style=for-the-badge&logo=github&label=Stars"></a>
</p>

---

## Что делает WispLoc

WispLoc превращает длинные записи в рабочие материалы:

```txt
audio/video -> transcript -> chunk summaries -> final summary -> draft tasks
```

Приложение работает на вашем компьютере и хранит файлы, транскрипции, summary, задачи, модели, логи и настройки локально в `~/.wisploc`.

WispLoc рассчитан на слабые устройства: обработка по умолчанию идет последовательно, длинные файлы нарезаются на чанки, прогресс сохраняется после важных шагов.

## Технологии

| Область | Технологии | Назначение |
| --- | --- | --- |
| Frontend | React, TypeScript, Vite | Локальный web-интерфейс |
| UI | HeroUI, Tailwind CSS, React Hook Form, Zod | Компоненты, стили, формы и валидация |
| Навигация | React Router | Переходы между страницами |
| Состояние и данные | Zustand, TanStack Query | Состояние клиента, API и кэширование запросов |
| Backend | Node.js, Fastify | Локальный HTTP API и раздача web-приложения |
| База данных | SQLite, Prisma | Локальное хранение и миграции |
| Очередь | Worker на SQLite | Последовательная фоновая обработка |
| Медиа | FFmpeg, ffprobe | Анализ медиа и нарезка аудио на чанки |
| Транскрибация | whisper.cpp, whisper-cli | Локальное мультиязычное распознавание речи |
| Summary | Ollama, qwen3:4b | Локальные summary и извлечение задач |
| Интеграции | GitHub Issues API | Создание проверенных внешних задач |
| Управление пакетами | pnpm workspaces | Управление зависимостями monorepo |

---

## Установка

npm-пакет устанавливает только легкую оболочку приложения. Большие зависимости устанавливаются позже со страницы локального setup.

Скопируйте и выполните:

```bash
npm install -g @gilbertfrost/wisploc
```

Запустите WispLoc:

```bash
wisploc start
```

WispLoc откроет локальный web UI:

```txt
http://localhost:3030
```

Если установка зависимостей еще не завершена, WispLoc откроет:

```txt
http://localhost:3030/setup
```

Каждая команда вынесена в отдельный блок кода, чтобы GitHub, npm и большинство Markdown-интерфейсов показывали кнопку копирования.

---

## Первый setup

На странице setup нажмите:

```txt
Install all required components
```

Setup установит и проверит:

- рабочие директории `~/.wisploc`;
- локальную SQLite базу;
- FFmpeg и `ffprobe`;
- `whisper.cpp` / `whisper-cli`;
- мультиязычную модель Whisper `ggml-base.bin`;
- Ollama;
- локальную LLM модель `qwen3:4b`;
- финальную диагностику окружения.

Большие бинарные файлы и модели не скачиваются во время `npm install`. Пользователь запускает это сам со страницы setup.

---

## Поддерживаемые платформы

| Платформа | Статус |
| --- | --- |
| Linux | Работает и протестировано |
| Windows | Поддержка в процессе |
| macOS | Поддержка в процессе |

---

## Использование

1. Запустите WispLoc.
2. Откройте локальный web UI.
3. Завершите setup, если он еще не выполнен.
4. Загрузите аудио или видео на странице Media.
5. Дождитесь окончания обработки.
6. Откройте транскрипцию, summary и черновики задач.
7. Проверьте задачи перед отправкой во внешний трекер.

WispLoc по умолчанию не отправляет полные транскрипции во внешние трекеры.

## Интеграция с GitHub

WispLoc умеет создавать GitHub Issues из проверенных и одобренных извлеченных задач. Подключите Personal Access Token GitHub, выберите репозиторий, проверьте задачу и явно подтвердите создание issue. Полные транскрипции в GitHub не отправляются.

Для интеграции нужен токен с доступом к метаданным репозитория и правом создавать или изменять Issues. Рекомендуется использовать fine-grained token, ограниченный нужным репозиторием.

---

## Команды

Запустить WispLoc:

```bash
wisploc start
```

Проверить, запущен ли WispLoc:

```bash
wisploc status
```

Остановить WispLoc:

```bash
wisploc stop
```

`wisploc stop` также останавливает управляемый WispLoc процесс Ollama, если он был запущен приложением.

---

## Локальные данные

WispLoc хранит runtime-данные здесь:

```txt
~/.wisploc/
  bin/
  models/
  data/
  logs/
  config.json
```

Загруженные медиафайлы:

```txt
~/.wisploc/data/uploads
```

Диагностические логи:

```txt
~/.wisploc/logs/setup.log
~/.wisploc/logs/worker.log
~/.wisploc/logs/maintenance.log
```

---

## Если setup не проходит

Откройте страницу setup и посмотрите, какой шаг упал:

```txt
http://localhost:3030/setup
```

Проверьте лог установки:

```bash
tail -n 200 ~/.wisploc/logs/setup.log
```

После этого запустите setup снова из web UI. Setup идемпотентный: уже установленные компоненты пропускаются, а частично скачанные файлы используются для продолжения там, где это безопасно.

Если ошибка связана с сетью, проверьте доступ к GitHub, Hugging Face и Ollama release downloads.

---

## Важно

- WispLoc является локальным web-приложением, а не облачным SaaS.
- Обработка медиа выполняется локально.
- Python не требуется.
- Большие зависимости устанавливаются со страницы setup, а не во время `npm install`.
- Внешние интеграции получают только выбранные пользователем задачи.
- Проверяйте извлеченные задачи перед созданием внешних issues.

---

## Участие в разработке

WispLoc открыт для pull request от сообщества. Перед созданием PR прочитайте [CONTRIBUTING.md](./CONTRIBUTING.md).

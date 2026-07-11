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
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-qwen3%3A4b-000000?style=for-the-badge">
  <img alt="Whisper" src="https://img.shields.io/badge/Whisper.cpp-ggml--base-000000?style=for-the-badge">
</p>

---

## Что делает WispLoc

WispLoc превращает длинные записи в рабочие материалы:

```txt
audio/video -> transcript -> chunk summaries -> final summary -> draft tasks
```

Приложение работает на вашем компьютере и хранит файлы, транскрипции, summary, задачи, модели, логи и настройки локально в `~/.wisploc`.

WispLoc рассчитан на слабые устройства: обработка по умолчанию идет последовательно, длинные файлы нарезаются на чанки, прогресс сохраняется после важных шагов.

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

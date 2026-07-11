<p align="right">
  <a href="./README.ru.md">Русский</a> · <strong>English</strong>
</p>

<h1 align="center">WispLoc</h1>

<p align="center">
  <strong>Local web UI for long audio and video processing.</strong>
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

## What WispLoc Does

WispLoc turns long recordings into structured work material:

```txt
audio/video -> transcript -> chunk summaries -> final summary -> draft tasks
```

It runs on your computer and keeps files, transcripts, summaries, tasks, models, logs, and configuration locally under `~/.wisploc`.

WispLoc is built for weak devices: processing is sequential by default, long media is split into chunks, and progress is saved after important steps.

---

## Install

The npm package installs only the lightweight application shell. Large dependencies are installed later from the local setup page.

Copy and run:

```bash
npm install -g @gilbertfrost/wisploc
```

Start WispLoc:

```bash
wisploc start
```

WispLoc opens the local web UI:

```txt
http://localhost:3030
```

If setup is not complete yet, WispLoc opens:

```txt
http://localhost:3030/setup
```

Every command is placed in its own code block so GitHub, npm, and most Markdown viewers can show a one-click copy button.

---

## First Setup

On the setup page, click:

```txt
Install all required components
```

Setup installs and validates:

- runtime directories under `~/.wisploc`;
- local SQLite database;
- FFmpeg and `ffprobe`;
- `whisper.cpp` / `whisper-cli`;
- multilingual Whisper model `ggml-base.bin`;
- Ollama;
- local LLM model `qwen3:4b`;
- final environment diagnostics.

Large binaries and models are not downloaded during `npm install`. The user controls this from the setup page.

---

## Supported Platforms

| Platform | Status |
| --- | --- |
| Linux | Works and has been tested |
| Windows | Support is in progress |
| macOS | Support is in progress |

---

## Usage

1. Start WispLoc.
2. Open the local web UI.
3. Complete setup if needed.
4. Upload an audio or video file on the Media page.
5. Wait for processing to finish.
6. Open transcript, summary, and draft tasks.
7. Review tasks before sending anything to an external tracker.

WispLoc does not send full transcripts to issue trackers by default.

---

## Commands

Start WispLoc:

```bash
wisploc start
```

Check whether WispLoc is running:

```bash
wisploc status
```

Stop WispLoc:

```bash
wisploc stop
```

`wisploc stop` also stops the WispLoc-managed Ollama process if it was started by the app.

---

## Local Data

WispLoc stores runtime data here:

```txt
~/.wisploc/
  bin/
  models/
  data/
  logs/
  config.json
```

Uploaded media files:

```txt
~/.wisploc/data/uploads
```

Diagnostic logs:

```txt
~/.wisploc/logs/setup.log
~/.wisploc/logs/worker.log
~/.wisploc/logs/maintenance.log
```

---

## If Setup Fails

Open the setup page and check the failed step:

```txt
http://localhost:3030/setup
```

Inspect the setup log:

```bash
tail -n 200 ~/.wisploc/logs/setup.log
```

Then run setup again from the web UI. Setup is idempotent: already installed components are skipped, and partial downloads are reused when it is safe.

For network-related failures, check access to GitHub, Hugging Face, and Ollama release downloads.

---

## Important Notes

- WispLoc is a local web application, not a cloud SaaS product.
- Media processing runs locally.
- Python is not required.
- Large dependencies are installed from the setup page, not during `npm install`.
- External integrations receive only user-selected task data.
- Review extracted tasks before creating external issues.

---

## Contributing

WispLoc accepts community contributions. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

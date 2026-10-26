# Rubber Duck Learning

<a href="https://github.com/EvanGruhlkey/rubber-duck-learning/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a> <a href="https://github.com/EvanGruhlkey/rubber-duck-learning/stargazers"><img src="https://img.shields.io/github/stars/EvanGruhlkey/rubber-duck-learning?style=flat" alt="Stars" /></a>

<p align="center">
  <img src="apps/duck-desktop/public/duck.svg" width="112" height="112" alt="Pixel art rubber duck" />
</p>

<p align="center">
  <img src="docs/rubber-duck-demo.gif" width="960" alt="Rubber Duck taking a question, streaming a reply, and returning to the textbox" />
</p>

This repo is a desktop rubber duck for developers who want help thinking through code.

Rubber Duck Learning gives you a movable duck icon that stays on your screen while you code. Click it when you are stuck, paste an error or describe the bug, and it responds with Socratic questions, file-reading prompts, and small hints instead of dumping the solution.

## Why

Most AI coding tools optimize for speed. Rubber Duck Learning optimizes for understanding.

It helps you debug, trace, and reason through code while keeping you in control.

## Run the desktop duck

```bash
cd apps/duck-desktop
npm install
npm run tauri dev
```

Needs [Rust](https://www.rust-lang.org/tools/install) and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Details: [`apps/duck-desktop/README.md`](./apps/duck-desktop/README.md).

This repo is inspired by real life rubber duck debugging ifykyk

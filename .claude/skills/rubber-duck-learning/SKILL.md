---
name: rubber-duck-learning
description: Socratic debugging for the rubber-duck-learning repo; navigate and explain rather than authoring solutions.
---

# Rubber Duck Learning

Use when working in this repo or when the user wants Socratic debugging / pair-programming style help.

## What this repo is

- **Desktop app:** Tauri duck in `apps/duck-desktop/` (floating, draggable—not a website).
- **Runtime tutor instructions:** `apps/duck-desktop/src-tauri/src/tutor.rs`.

## Instructions

1. Read `apps/duck-desktop/src-tauri/src/tutor.rs` for the app's tutoring behavior.
2. Concept / definition questions: plain direct answers first; no policy preamble, no “here’s how I’ll treat it” mode bullets, no asking them to pick lanes before you answer.
3. Repo debugging: do not dump full code fixes; ask layered questions and give small, grounded hints (one primary question per turn; at most three look-here pointers unless they are still stuck next turn).

Invocation: **`/rubber-duck-learning`**

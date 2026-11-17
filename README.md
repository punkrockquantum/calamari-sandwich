# Calamari Sandwich

**Calamari Sandwich** is a full-stack creative AI tech-explainer video studio for turning complex technology topics into engaging 2–30 minute multi-chapter explainer videos.

## Core Capabilities

- **Topic-to-Chapter Studio (2–30 min)**: Automatic multi-chapter pacing, narration scripts, visual metaphors, and scene breakdowns.
- **Character Cloning**: Upload up to 5 photos or 1 short video with validation, trait extraction/styling, and ready-to-use presets.
- **Dedicated API Connectors Hub**: Pluggable provider adapters with server-side env secret handling, optional session-only header keys, live **Test Connection** checks, and full **Demo Mode** fallbacks for:
  1. **ElevenLabs** (`ELEVENLABS_API_KEY`) — Voice import & text-to-speech synthesis
  2. **Higgsfield** (`HIGGSFIELD_API_KEY`) — Dynamic cinematic scene generation & camera motion
  3. **Character Cloning** (`CHARACTER_CLONE_API_KEY`) — Reference photo/video cloning & trait styling
  4. **Script & Prompt Director LLM** (`DIRECTOR_LLM_API_KEY`) — Topic-to-script generation & prompt-based iteration
  5. **Music / Soundtrack** (`MUSIC_API_KEY`) — Adaptive background score generation
- **Prompt-Based Iterative Editing**: Unified **Director Prompt** bar with **Undo / Redo** & **Iteration History** synced to a 4-track NLE timeline (`Scenes`, `Characters`, `Voiceover`, `Music`) and live 16:9 HTML5 Canvas preview player.

## Local Development

```bash
npm install
npm run dev
```

- Web UI: `http://127.0.0.1:5173`
- API Server: `http://127.0.0.1:3001`

## Verification

```bash
npm run typecheck
npm test
npm run build
```

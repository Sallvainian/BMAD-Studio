# BMAD-Studio — Project Documentation Index

**Generated:** 2026-02-23 | **Version:** 2.7.14 | **Scan Level:** Deep

## Project Overview

BMAD-Studio is an autonomous multi-agent coding framework packaged as a cross-platform desktop application. Users describe a goal and AI agents autonomously handle specification creation, implementation planning, code generation, and QA validation — all in isolated git worktrees.

**Architecture:** Monorepo with 2 parts — Python backend (agent orchestration) + Electron/React frontend (desktop UI), connected via npm workspaces.

## Documentation Files

| Document | Description |
|----------|-------------|
| [Project Overview](./project-overview.md) | Executive summary, product purpose, key features, technology stack |
| [Architecture — Backend](./architecture-backend.md) | Python agent system: SDK client, agents, spec pipeline, QA, security, integrations |
| [Architecture — Frontend](./architecture-frontend.md) | Electron app: main process, renderer, preload, stores, components, terminal, profiles |
| [Source Tree Analysis](./source-tree-analysis.md) | Annotated directory tree, critical folders, entry points |
| [Integration Architecture](./integration-architecture.md) | IPC patterns, external service integrations (Claude, GitHub, GitLab, Linear, Graphiti), data flows |
| [Component Inventory](./component-inventory.md) | React components, Zustand stores, IPC handlers, preload APIs, backend modules, types, hooks, i18n |
| [Development Guide](./development-guide.md) | Prerequisites, setup, running, testing, linting, code style, Git workflow, i18n |
| [Deployment Guide](./deployment-guide.md) | CI/CD workflows, release process, packaging, code signing, auto-updates, error tracking |

## Technology Stack

### Frontend
Electron 40 | React 19 | TypeScript 5.9 (strict) | Zustand 5 | Tailwind CSS 4 | Radix UI | xterm.js 6 | Vite 7 | Biome 2 | Vitest 4 | Playwright 1.52

### Backend
Python 3.12+ | Claude Agent SDK 0.1.39+ | Pydantic 2 | Graphiti + LadybugDB | Ruff 0.14 | pytest 9

## Key Entry Points

| Part | Entry Point | Purpose |
|------|-------------|---------|
| Backend CLI | `apps/backend/run.py` → `cli/main.py` | CLI with 50+ flags |
| Frontend Main | `apps/frontend/src/main/index.ts` | Electron window, IPC, services |
| Frontend Renderer | `apps/frontend/src/renderer/App.tsx` | React root component |
| Frontend Preload | `apps/frontend/src/preload/index.ts` | contextBridge API |

## Scale Summary

| Metric | Count |
|--------|-------|
| Frontend Components | 90+ across 18 feature directories |
| Zustand Stores | 31 |
| IPC Handler Modules | 84+ |
| Preload API Modules | 26 |
| Custom React Hooks | 11 |
| Type Definition Files | 21 |
| i18n Namespaces | 11 (English + French) |
| Backend Python Modules | 25+ major, 300+ files |
| CI/CD Workflows | 16 |
| Agent System Prompts | 10+ |

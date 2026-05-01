# BMAD-Studio — Project Overview

**Generated:** 2026-02-23 | **Version:** 2.7.14 | **Scan Level:** Deep

## Executive Summary

BMAD-Studio (formerly Auto-Claude) is an autonomous multi-agent coding framework that plans, builds, and validates software features end-to-end. Users describe a goal and AI agents autonomously handle specification creation, implementation planning, code generation, and QA validation — all in isolated git worktrees so the main branch stays safe.

The system is packaged as a cross-platform desktop application (Windows, macOS, Linux) with a Python backend for agent orchestration and an Electron/React frontend for the desktop UI.

## Product Purpose

BMAD-Studio solves the problem of turning high-level feature descriptions into working code with minimal human intervention. The core workflow is:

1. **User creates a task** — describes what they want built
2. **Spec creation pipeline** — AI assesses complexity, gathers requirements, researches context, and writes a specification
3. **Planner agent** — breaks the spec into phases and subtasks
4. **Coder agent** — implements each subtask (can spawn parallel subagents)
5. **QA reviewer** — validates the implementation against acceptance criteria
6. **QA fixer** — resolves any issues found
7. **User reviews and merges** — approves the completed work

## Key Features

- **Autonomous Tasks** — Multi-agent pipeline (planner, coder, QA) that builds features end-to-end
- **Kanban Board** — Visual task management from planning through completion
- **Agent Terminals** — Up to 12 parallel AI-powered terminals with task context injection
- **Insights** — AI chat interface for exploring and understanding your codebase
- **Roadmap** — AI-assisted feature planning with strategic roadmap generation
- **Ideation** — Discover improvements, performance issues, and security vulnerabilities
- **GitHub/GitLab Integration** — Import issues, AI-powered investigation, PR/MR review and creation
- **Changelog** — Generate release notes from completed tasks
- **Memory System** — Graphiti-based knowledge graph retains insights across sessions
- **Isolated Workspaces** — Git worktree isolation for every build; AI-powered semantic merge
- **Flexible Authentication** — Use Claude Code subscription (OAuth) or API profiles with any Anthropic-compatible endpoint
- **Multi-Account Swapping** — Register multiple Claude accounts; auto-switches when one hits a rate limit
- **Cross-Platform** — Native desktop app for Windows, macOS, and Linux with auto-updates

## Repository Structure

| Aspect | Detail |
|--------|--------|
| **Type** | Monorepo (npm workspaces) |
| **Parts** | 2 — Python backend + Electron/React frontend |
| **Root** | `apps/backend/` (Python) and `apps/frontend/` (Electron) |
| **License** | AGPL-3.0 |
| **CI/CD** | 16 GitHub Actions workflows |

## Technology Stack Summary

### Frontend (Electron/React Desktop App)

| Category | Technology | Version |
|----------|-----------|---------|
| Desktop Framework | Electron | 40.0.0 |
| UI Framework | React | 19.2.3 |
| Language | TypeScript | 5.9.3 (strict) |
| State Management | Zustand | 5.0.9 |
| Styling | Tailwind CSS | 4.1.17 |
| Component Library | Radix UI | 1.x–2.x |
| Terminal Emulation | xterm.js | 6.0.0 |
| Animation | Motion (Framer) | 12.23.26 |
| Drag & Drop | @dnd-kit | 6.3.1 / 10.0.0 |
| Validation | Zod | 4.2.1 |
| State Machine | XState | 5.26.0 |
| Build Tool | Vite | 7.2.7 |
| Linting | Biome | 2.3.11 |
| Testing | Vitest + Playwright | 4.0.16 / 1.52.0 |

### Backend (Python Agent System)

| Category | Technology | Version |
|----------|-----------|---------|
| Language | Python | 3.12+ |
| AI SDK | Claude Agent SDK | 0.1.39+ |
| Data Validation | Pydantic | 2.0+ |
| Memory | Graphiti + LadybugDB | 0.5.0+ / 0.13.0+ |
| Google AI | google-generativeai | 0.8.0+ |
| Config | PyYAML + python-dotenv | 6.0+ / 1.0+ |
| Error Tracking | Sentry SDK | 2.0+ |
| Linting | Ruff | 0.14.10 |
| Testing | pytest | 9.0.2 |

## Architecture Pattern

**Three-process Electron** (main / preload / renderer) **+ Python subprocess agent system** with IPC bridge.

- The **Electron main process** manages windows, IPC handlers, agent lifecycle, terminal PTY daemons, and Claude profile management
- The **preload bridge** exposes a safe `ElectronAPI` to the renderer via `contextBridge`
- The **React renderer** implements the UI with 20 Zustand stores, 69+ components, and feature-based organization
- The **Python backend** runs as a subprocess, executing the agent pipeline (spec → plan → code → QA) using the Claude Agent SDK

## Links to Detailed Documentation

- [Architecture — Backend](./architecture-backend.md)
- [Architecture — Frontend](./architecture-frontend.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Integration Architecture](./integration-architecture.md)
- [Component Inventory](./component-inventory.md)
- [Development Guide](./development-guide.md)
- [Deployment Guide](./deployment-guide.md)

# Deployment Guide

**Generated:** 2026-02-23 | **Scan Level:** Deep

## Overview

BMAD-Studio is distributed as a cross-platform desktop application via GitHub Releases. The build pipeline packages the Electron frontend with a bundled Python runtime, producing native installers for macOS, Windows, and Linux.

## CI/CD Workflows

16 GitHub Actions workflows in `.github/workflows/`:

### Release Pipelines

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| prepare-release.yml | Push to `main` with version bump | Validates CHANGELOG.md, creates git tag |
| release.yml | Tag `v*` pushed or manual dispatch | Builds and publishes all platform installers |
| beta-release.yml | Manual dispatch on `develop` | Beta release with version validation |

### Quality and Testing

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| ci.yml | Push to main/develop, PRs | Python (3.12, 3.13) + Frontend tests on 3 OS |
| lint.yml | Push to main/develop, PRs | Ruff (Python) + Biome + TypeScript (Frontend) |
| quality-security.yml | Push to main, PRs, weekly | CodeQL (Python, JS/TS) + Bandit security scan |
| virustotal-scan.yml | Post-release | VirusTotal scan on built binaries |

### Build and Infrastructure

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| build-prebuilds.yml | Release published or manual | Native module prebuilds (node-pty) |
| test-azure-auth.yml | Manual dispatch | OIDC/Azure auth verification |

### Automation

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| claude.yml | @claude mention | Claude mention detection |
| claude-code-review.yml | @claude mention | Automated PR code review |
| pr-labeler.yml | PR creation/update | Auto-label from conventional commits |
| issue-auto-label.yml | Issue creation | Auto-label issues by area |
| stale.yml | Scheduled (60 days) | Mark stale issues as inactive |
| welcome.yml | First-time contributor | Greeting message |
| discord-release.yml | Release published | Discord webhook notifications |

## Release Process

### Step 1: Bump Version

```bash
node scripts/bump-version.js patch|minor|major|X.Y.Z
```

Updates version in:
- `apps/frontend/package.json`
- `package.json` (root)
- `apps/backend/__init__.py`

Creates commit: `chore: bump version to X.Y.Z`

### Step 2: Update CHANGELOG.md

Required format:
```markdown
## X.Y.Z - Release Title

### New Features
- Feature description

### Improvements
- Improvement description

### Bug Fixes
- Fix description
```

### Step 3: Create PR to Main

```bash
git push origin your-branch
gh pr create --base main --title "Release vX.Y.Z"
```

Target `main`, NOT `develop`.

### Step 4: Merge Triggers Automation

1. `prepare-release.yml` detects version bump, validates CHANGELOG, creates tag
2. `release.yml` builds binaries for all platforms
3. Post-release: VirusTotal scan, Discord notification

## Packaging

### Build Commands

| Command | Target |
|---------|--------|
| `npm run package` | All platforms |
| `npm run package:mac` | macOS (DMG + ZIP) |
| `npm run package:win` | Windows (NSIS + ZIP) |
| `npm run package:linux` | Linux (AppImage + .deb) |
| `npm run package:flatpak` | Linux Flatpak |

### Python Runtime Bundling

```bash
npm run python:download          # Download Python for current OS
npm run python:download:all      # Download for all platforms
npm run python:verify            # Verify bundle integrity
```

The packaging script (`apps/frontend/scripts/package-with-python.cjs`) downloads a bundled Python runtime per platform/architecture, stages it into `python-runtime/`, and includes it via electron-builder's `extraResources`.

### Electron Builder Configuration

**App Identity:**
- App ID: `com.bmadstudio.app`
- Product Name: BMAD-Studio
- Artifact pattern: `${productName}-${version}-${platform}-${arch}.${ext}`
- Publish provider: GitHub (owner: Sallvainian, repo: BMAD-Studio)

**Bundled Resources:**
- Compiled frontend (`out/**/*`)
- Backend Python source (filtered: no .git, __pycache__, .venv, tests)
- Bundled Python runtime (platform-specific)
- Python site-packages (platform-specific)
- Application icon

**ASAR Unpacking:** `@lydell/node-pty` (native module, rebuilt per platform)

## Platform-Specific Configuration

### macOS

| Setting | Value |
|---------|-------|
| Category | public.app-category.developer-tools |
| Targets | DMG, ZIP |
| Hardened Runtime | Enabled |
| Gatekeeper Assess | Disabled |
| Entitlements | `resources/entitlements.mac.plist` |
| Architectures | x64 (Intel), arm64 (Apple Silicon) |

### Windows

| Setting | Value |
|---------|-------|
| Targets | NSIS installer, ZIP |
| Icon | `resources/icon.ico` |
| Architecture | x64 |

### Linux

| Setting | Value |
|---------|-------|
| Targets | AppImage, .deb |
| Category | Development |
| Icons | `resources/icons/` (directory) |
| Architecture | x64, arm64 |

### Flatpak

| Setting | Value |
|---------|-------|
| Runtime | org.freedesktop.Platform 25.08 |
| SDK | org.freedesktop.Sdk 25.08 |
| Base | org.electronjs.Electron2.BaseApp 25.08 |
| Permissions | Wayland/X11, IPC, network, DRI, home filesystem, notifications |

## Code Signing

### macOS Signing and Notarization

**Required Secrets:**
- `MACOS_CERTIFICATE_P12_BASE64` — Base64-encoded signing certificate
- `MACOS_CERTIFICATE_PASSWORD` — Certificate password
- `APPLE_ID` — Apple ID email for notarization
- `APPLE_APP_SPECIFIC_PASSWORD` — App-specific password
- `APPLE_TEAM_ID` — Apple Team ID

The release workflow decodes the certificate, imports it, then signs and notarizes the built application.

### Windows Signing

Azure Trusted Signing configured in `beta-release.yml` for beta releases.

## Version Numbering

**Semantic Versioning:**

| Component | When to Increment |
|-----------|-------------------|
| MAJOR (X.0.0) | Breaking changes |
| MINOR (0.X.0) | New features, backwards compatible |
| PATCH (0.0.X) | Bug fixes, backwards compatible |

**Pre-release Formats:**
- `X.Y.Z-beta.N` (e.g., 2.8.0-beta.1)
- `X.Y.Z-alpha.N` (e.g., 2.8.0-alpha.1)
- `X.Y.Z-rc.N` (e.g., 2.8.0-rc.1)

Beta releases are triggered manually via GitHub Actions and published as pre-releases. Users opt in via Settings > Updates > Beta Updates.

## Auto-Updates

| Component | Implementation |
|-----------|---------------|
| Framework | electron-updater 6.6.2 |
| Provider | GitHub Releases |
| UI | `AppUpdateNotification.tsx` |
| Handler | `app-update-handlers.ts` |

The app checks for updates on launch and notifies users when new versions are available.

## Error Tracking

| Layer | Implementation |
|-------|---------------|
| Frontend | @sentry/electron 7.5.0 via `sentry.ts` |
| Backend | sentry-sdk 2.0+ via CLI initialization |

**Required Secrets:**
- `SENTRY_DSN` — Error reporting endpoint
- `SENTRY_TRACES_SAMPLE_RATE` — Performance sampling rate
- `SENTRY_PROFILES_SAMPLE_RATE` — Profile sampling rate

## CI Test Matrix

**Python Tests:**

| OS | Python Versions |
|----|----------------|
| Ubuntu Linux | 3.12, 3.13 |
| Windows | 3.12 |
| macOS | 3.12 |

Default: Skips slow tests (`-m "not slow"`)

**Frontend Tests:** Vitest unit tests, Biome linting, TypeScript type checking, Playwright E2E

**Security:** CodeQL (Python + JS/TS), Bandit (Python security)

## Verification Commands

```bash
npm run python:verify           # Verify Python bundling
npm run verify:linux            # Verify Linux package structure
npm run test:verify-linux       # Node test for Linux packages
```

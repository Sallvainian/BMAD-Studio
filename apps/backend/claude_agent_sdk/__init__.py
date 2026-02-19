"""
Compatibility stub for claude-agent-sdk.

The real claude-agent-sdk Python package has been removed. All agent logic
has been migrated to the TypeScript Vercel AI SDK layer in
apps/frontend/src/main/ai/.

This stub provides no-op classes so that any remaining Python code that
hasn't been fully cleaned up yet won't crash on import.
"""


class ClaudeSDKClient:
    """Stub — agent sessions are now run via TypeScript."""

    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "claude-agent-sdk has been removed. Agent sessions are now "
            "managed by the TypeScript Vercel AI SDK layer."
        )


class ClaudeAgentOptions:
    """Stub options dataclass."""

    def __init__(self, *args, **kwargs):
        pass


class AgentDefinition:
    """Stub agent definition."""

    def __init__(self, *args, **kwargs):
        pass


def query(*args, **kwargs):
    """Stub query function."""
    raise NotImplementedError("claude-agent-sdk has been removed.")


def tool(*args, **kwargs):
    """Stub tool decorator."""

    def decorator(fn):
        return fn

    return decorator


def create_sdk_mcp_server(*args, **kwargs):
    """Stub MCP server factory."""
    raise NotImplementedError("claude-agent-sdk has been removed.")

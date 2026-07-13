"""PromptBuster shim plugin for Hermes Agent.

Hermes is a Python harness, so this thin plugin registers the pre-model
`transform_tool_result` hook and shells out to the PromptBuster Node CLI to do
the actual scanning. Hermes swallows hook exceptions (fails open), so this shim
fails CLOSED on scanner error when PROMPTBUSTER_FAIL_CLOSED=1.

Install: copied by `prompt-buster install --hermes` to
~/.hermes/plugins/prompt-buster/. Enable in ~/.hermes/config.yaml:
    plugins:
      enabled: [prompt-buster]
"""

import json
import os
import subprocess

WEB_TOOLS = {"web_search", "web_extract", "web_fetch", "browser_snapshot"}
FAIL_CLOSED = os.environ.get("PROMPTBUSTER_FAIL_CLOSED") == "1"
# The installer rewrites this to an absolute path to bin/prompt-buster.mjs.
PROMPT_BUSTER_CLI = os.environ.get("PROMPTBUSTER_CLI", "prompt-buster")


def _scan(text):
    node = os.environ.get("PROMPTBUSTER_NODE", "node")
    args = ([PROMPT_BUSTER_CLI] if PROMPT_BUSTER_CLI == "prompt-buster"
            else [node, PROMPT_BUSTER_CLI])
    try:
        proc = subprocess.run(
            args + ["scan", "--stdin", "--harness", "hermes", "--output", "json"],
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=45,
        )
        return json.loads(proc.stdout.decode("utf-8"))
    except Exception:
        return None


def _transform_tool_result(tool_name, arguments, result, task_id=None, **kwargs):
    if tool_name not in WEB_TOOLS and not str(tool_name).startswith("mcp_"):
        return None
    text = result if isinstance(result, str) else json.dumps(result)
    if not text.strip():
        return None
    verdict = _scan(text)
    if verdict is None:
        # Scanner unavailable: fail closed (block) or open (pass) per config.
        if FAIL_CLOSED:
            return "PromptBuster could not scan this content and is configured to fail closed. Content withheld."
        return None
    if verdict.get("allowed") and verdict.get("content") is not None:
        return None  # clean — leave unchanged
    return verdict.get("message") or "PromptBuster blocked this content (possible prompt injection)."


def register(ctx):
    """Hermes plugin entry point."""
    ctx.register_hook("transform_tool_result", _transform_tool_result)

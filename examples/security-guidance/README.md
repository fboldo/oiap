# Security Guidance

OIAP rewrite of Anthropic's Claude Code `security-guidance` plugin.

Source plugin: <https://github.com/anthropics/claude-code/tree/main/plugins/security-guidance>

This example is for demonstrative purposes only. The upstream repository license
permits this adapted demonstration.

The OIAP version keeps the same core idea: a portable `before_tool` hook watches
file-edit tools and blocks the edit with a focused security reminder when it
detects common risky patterns.
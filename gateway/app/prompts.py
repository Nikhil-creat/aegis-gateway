"""Prompt contract shared by the agent (which builds synthesis prompts) and the mock provider."""

from __future__ import annotations

TOOL_MARK = "TOOL_RESULT:"
SEPARATOR = "\n---\n"


def build_synthesis_prompt(question: str, results: list[str]) -> str:
    return (
        "Answer the question using ONLY the tool results below. Keep any [doc:chunk] citations.\n"
        f"Question: {question}\n{TOOL_MARK}\n" + SEPARATOR.join(results)
    )


def parse_tool_results(prompt: str) -> list[str]:
    marker = TOOL_MARK + "\n"
    if marker not in prompt:
        return []
    tail = prompt.split(marker, 1)[1]
    return [b.strip() for b in tail.split(SEPARATOR) if b.strip()]

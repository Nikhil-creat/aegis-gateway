"""Sandboxed agent tools. No eval(): arithmetic goes through an allow-listed AST walker."""

from __future__ import annotations

import ast
import math
import operator
import re
from collections.abc import Callable

_BIN: dict[type[ast.operator], Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
    ast.Pow: operator.pow,
}
_UNARY: dict[type[ast.unaryop], Callable[[float], float]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_FUNCS: dict[str, Callable[[float], float]] = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log10,
    "ln": math.log,
    "abs": abs,
}
_CONSTS = {"pi": math.pi, "e": math.e}
MAX_EXPR_CHARS = 200
MAX_EXPONENT = 1000


class CalcError(ValueError):
    pass


def safe_calculator(expression: str) -> float:
    """Evaluate arithmetic. `^` means power. Raises CalcError on anything outside the allow-list."""
    expr = expression.strip().replace("^", "**")
    if not expr or len(expr) > MAX_EXPR_CHARS:
        raise CalcError("empty or too long")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise CalcError("syntax error") from exc

    def walk(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return float(node.value)
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
            left, right = walk(node.left), walk(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > MAX_EXPONENT:
                raise CalcError("exponent too large")
            try:
                return _BIN[type(node.op)](left, right)
            except (ZeroDivisionError, OverflowError) as exc:
                raise CalcError(type(exc).__name__) from exc
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](walk(node.operand))
        if isinstance(node, ast.Name) and node.id in _CONSTS:
            return _CONSTS[node.id]
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _FUNCS
            and len(node.args) == 1
            and not node.keywords
        ):
            try:
                return _FUNCS[node.func.id](walk(node.args[0]))
            except ValueError as exc:
                raise CalcError("math domain error") from exc
        raise CalcError(f"disallowed syntax: {type(node).__name__}")

    result = walk(tree)
    if not math.isfinite(result):
        raise CalcError("non-finite result")
    return result


def fmt_number(x: float) -> str:
    if x == int(x) and abs(x) < 1e15:
        return str(int(x))
    return f"{x:.6f}".rstrip("0").rstrip(".")


_PREFIX = re.compile(r"^\W*(?:first|next|then|please|calculate|compute|evaluate|what(?:'s| is))\b[\s,:]*", re.I)
_CANDIDATE = re.compile(
    r"(?:\b(?:sqrt|sin|cos|tan|log|ln|abs)\s*\(|[\d.()]|\bpi\b|\be\b|[-+*/^%])(?:[\s\d.()+\-*/^%]|\b(?:sqrt|sin|cos|tan|log|ln|abs)\b|\bpi\b)*",
    re.I,
)


def extract_math(clause: str) -> str | None:
    """Find a calculable expression inside a natural-language clause, or None."""
    text = clause.strip().rstrip("?.!,")
    stripped = text
    while True:
        new = _PREFIX.sub("", stripped, count=1)
        if new == stripped:
            break
        stripped = new
    candidates = [stripped] + [m.group(0).strip() for m in _CANDIDATE.finditer(text)]
    for cand in sorted({c for c in candidates if c}, key=len, reverse=True):
        if not re.search(r"\d", cand) or not re.search(r"[-+*/^%]|sqrt|sin|cos|tan|log|\bln\b|abs", cand, re.I):
            continue
        try:
            safe_calculator(cand)
        except CalcError:
            continue
        return cand
    return None

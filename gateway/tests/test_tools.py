import pytest

from app.tools import CalcError, extract_math, fmt_number, safe_calculator


@pytest.mark.parametrize(
    ("expr", "want"),
    [
        ("(12.5 * 8 + sqrt(144)) ^ 2 / 4", 3136),
        ("-2^2", -4),
        ("2^3^2", 512),
        ("10 % 4", 2),
        ("abs(-3) + pi - pi", 3),
        ("1000 / 8 + 0.5", 125.5),
    ],
)
def test_calculator_results(expr, want):
    assert safe_calculator(expr) == pytest.approx(want)


@pytest.mark.parametrize(
    "bad",
    [
        "__import__('os').system('id')",
        "().__class__",
        "open('x')",
        "2**100000",
        "1/0",
        "sqrt(-1)",
        "x + 1",
        "[1,2]",
        "lambda: 1",
        "",
        "9" * 300,
    ],
)
def test_calculator_rejects_everything_outside_the_allow_list(bad):
    with pytest.raises(CalcError):
        safe_calculator(bad)


def test_extract_math_from_sentences():
    assert extract_math("Calculate 60 * 24 * 60") == "60 * 24 * 60"
    assert extract_math("Next compute 300 / 60 to express it in minutes") == "300 / 60"
    assert extract_math("What is the capital of France?") is None
    assert extract_math("Who won in 2011?") is None


def test_number_formatting():
    assert fmt_number(3136.0) == "3136" and fmt_number(125.5) == "125.5" and fmt_number(1 / 3) == "0.333333"

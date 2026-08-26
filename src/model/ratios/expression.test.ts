import { describe, it, expect } from "vitest";
import { parseExpression, identifiers, evaluate, type Node } from "./expression";

function parsed(input: string): Node {
  const result = parseExpression(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error.message}`);
  return result.node;
}

function failure(input: string) {
  const result = parseExpression(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected`);
  return result.error;
}

/** Renders the tree back to a fully parenthesised string, so associativity is visible. */
function show(node: Node): string {
  switch (node.kind) {
    case "number":
      return String(node.value);
    case "ident":
      return node.name;
    case "unary":
      return `(-${show(node.operand)})`;
    case "binary":
      return `(${show(node.left)} ${node.op} ${show(node.right)})`;
  }
}

describe("parsing", () => {
  it("parses a simple quotient", () => {
    expect(show(parsed("a / b"))).toBe("(a / b)");
  });

  it("parses parentheses", () => {
    expect(show(parsed("(a + b) / c"))).toBe("((a + b) / c)");
  });

  it("parses a unary minus and a decimal literal", () => {
    expect(show(parsed("-a + 2.5 * b"))).toBe("((-a) + (2.5 * b))");
  });

  it("gives multiplication precedence over addition", () => {
    expect(show(parsed("a + b * c"))).toBe("(a + (b * c))");
  });

  it("associates subtraction to the left", () => {
    expect(show(parsed("a - b - c"))).toBe("((a - b) - c)");
  });

  it("associates division to the left", () => {
    expect(show(parsed("a / b / c"))).toBe("((a / b) / c)");
  });

  it("parses nested parentheses", () => {
    expect(show(parsed("2 * (a + (b - c))")).length).toBeGreaterThan(0);
  });

  it("ignores surrounding whitespace", () => {
    expect(show(parsed("   a/b  "))).toBe("(a / b)");
  });
});

describe("rejection", () => {
  it("rejects a trailing operator at its offset", () => {
    const error = failure("a +");
    expect(error.offset).toBe(3);
    expect(error.message).toMatch(/expected/i);
  });

  it("rejects an unclosed parenthesis", () => {
    expect(failure("(a").message).toMatch(/\)/);
  });

  it("rejects a stray closing parenthesis at its offset", () => {
    expect(failure("a )").offset).toBe(2);
  });

  it("rejects an empty expression", () => {
    expect(failure("").message).toMatch(/empty/i);
    expect(failure("    ").message).toMatch(/empty/i);
  });

  it("rejects an unknown character at its offset", () => {
    const error = failure("a $ b");
    expect(error.offset).toBe(2);
    expect(error.message).toMatch(/\$/);
  });

  it("rejects division by a literal zero", () => {
    expect(failure("a / 0").message).toMatch(/zero/i);
    expect(failure("a / 0.0").message).toMatch(/zero/i);
  });

  it("rejects operators the grammar does not have", () => {
    // The second star is the offending character, not the space after it.
    expect(failure("a ** b").offset).toBe(3);
    expect(failure("a % b").message).toMatch(/%/);
  });

  it("rejects a call, because there are no functions", () => {
    expect(failure("eval(a)").message).toMatch(/expected/i);
  });

  it("rejects a statement separator", () => {
    expect(failure("a; drop table").message).toMatch(/;/);
  });

  it("rejects an identifier that starts with a digit", () => {
    expect(failure("1a").message).toMatch(/expected/i);
  });
});

describe("identifiers", () => {
  it("lists each identifier once, in source order", () => {
    expect(identifiers(parsed("a / (b + a)"))).toEqual(["a", "b"]);
  });

  it("returns nothing for a pure arithmetic expression", () => {
    expect(identifiers(parsed("2 * 3"))).toEqual([]);
  });
});

describe("evaluation", () => {
  const resolve = (values: Record<string, number>) => (name: string) => values[name];

  it("computes a resolvable expression", () => {
    const result = evaluate(parsed("(a + b) / c"), resolve({ a: 3, b: 7, c: 2 }));
    expect(result).toEqual({ kind: "ok", value: 5 });
  });

  it("applies unary minus", () => {
    expect(evaluate(parsed("-a"), resolve({ a: 4 }))).toEqual({ kind: "ok", value: -4 });
  });

  it("names every missing identifier, not just the first", () => {
    const result = evaluate(parsed("a / (b + c)"), resolve({ b: 1 }));
    expect(result).toEqual({ kind: "unavailable", missing: ["a", "c"] });
  });

  it("reports a zero denominator rather than dividing", () => {
    const result = evaluate(parsed("a / b"), resolve({ a: 1, b: 0 }));
    expect(result).toEqual({ kind: "undefined_denominator", reason: "zero" });
  });

  it("treats a denominator inside rounding noise of zero as zero", () => {
    const result = evaluate(parsed("a / b"), resolve({ a: 1000, b: 0.4 }));
    expect(result).toEqual({ kind: "undefined_denominator", reason: "zero" });
  });

  it("divides by a negative denominator unless asked not to", () => {
    expect(evaluate(parsed("a / b"), resolve({ a: 10, b: -5 }))).toEqual({ kind: "ok", value: -2 });
    expect(
      evaluate(parsed("a / b"), resolve({ a: 10, b: -5 }), { positiveDenominator: true }),
    ).toEqual({ kind: "undefined_denominator", reason: "negative" });
  });

  it("propagates a nested failure to the whole expression", () => {
    expect(evaluate(parsed("1 + a / b"), resolve({ a: 1, b: 0 }))).toEqual({
      kind: "undefined_denominator",
      reason: "zero",
    });
    expect(evaluate(parsed("1 + a / b"), resolve({ b: 2 }))).toEqual({
      kind: "unavailable",
      missing: ["a"],
    });
  });

  it("prefers a missing input over a degenerate denominator", () => {
    const result = evaluate(parsed("a / b"), resolve({ b: 0 }));
    expect(result).toEqual({ kind: "unavailable", missing: ["a"] });
  });

  it("never returns NaN or Infinity", () => {
    const cases: [string, Record<string, number>][] = [
      ["a / b", { a: 1, b: 0 }],
      ["a / b", { a: 0, b: 0 }],
      ["a * b", { a: 1e308, b: 1e308 }],
      ["a - b", { a: Number.NaN, b: 1 }],
    ];
    for (const [source, values] of cases) {
      const result = evaluate(parsed(source), resolve(values));
      expect(result.kind === "ok" && !Number.isFinite(result.value), source).toBe(false);
    }
  });

  it("reports arithmetic that cannot produce a usable number", () => {
    expect(evaluate(parsed("a * b"), resolve({ a: 1e308, b: 1e308 }))).toEqual({
      kind: "not_a_number",
    });
  });
});

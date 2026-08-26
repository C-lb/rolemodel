import { closeEnough } from "../tolerance";

/**
 * A deliberately small expression language for ratios: identifiers, numbers, the four
 * arithmetic operators, parentheses and unary minus. Nothing else.
 *
 * Hand-written tokeniser and recursive-descent parser, because the alternatives all end
 * somewhere near `eval`, and a user-supplied string that reaches `eval` is a hole in an
 * application that reads financial documents off disk.
 */

export type Node =
  | { kind: "number"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "unary"; op: "-"; operand: Node }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Node; right: Node };

export interface ParseError {
  message: string;
  /** Character offset into the input, so the field can point at the problem. */
  offset: number;
}

export type ParseResult = { ok: true; node: Node } | { ok: false; error: ParseError };

type Token =
  | { kind: "number"; value: number; offset: number; text: string }
  | { kind: "ident"; name: string; offset: number; text: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/"; offset: number; text: string }
  | { kind: "lparen"; offset: number; text: string }
  | { kind: "rparen"; offset: number; text: string };

class ExpressionError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

const OPERATORS = new Set(["+", "-", "*", "/"]);

function tokenise(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < input.length && /[0-9]/.test(input[i])) i += 1;
      if (input[i] === ".") {
        i += 1;
        while (i < input.length && /[0-9]/.test(input[i])) i += 1;
      }
      const text = input.slice(start, i);
      // `1a` is a typo, not a number followed by an identifier. Rejecting it here means the
      // parser never has to guess which half the user meant.
      if (i < input.length && /[a-zA-Z_]/.test(input[i])) {
        throw new ExpressionError(`Expected an operator after "${text}".`, i);
      }
      tokens.push({ kind: "number", value: Number(text), offset: start, text });
      continue;
    }

    if (/[a-z]/.test(ch)) {
      const start = i;
      while (i < input.length && /[a-z0-9_]/.test(input[i])) i += 1;
      const text = input.slice(start, i);
      tokens.push({ kind: "ident", name: text, offset: start, text });
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ kind: "op", op: ch as "+" | "-" | "*" | "/", offset: i, text: ch });
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lparen", offset: i, text: ch });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ kind: "rparen", offset: i, text: ch });
      i += 1;
      continue;
    }

    throw new ExpressionError(`"${ch}" is not something this expression can contain.`, i);
  }

  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  /** Offset to blame when the input simply ran out. */
  private endOffset(): number {
    return this.length;
  }

  parse(): Node {
    if (this.tokens.length === 0) throw new ExpressionError("The expression is empty.", 0);
    const node = this.expression();
    const leftover = this.peek();
    if (leftover) {
      throw new ExpressionError(
        `Unexpected "${leftover.text}" after a complete expression.`,
        leftover.offset,
      );
    }
    return node;
  }

  private expression(): Node {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (token?.kind === "op" && (token.op === "+" || token.op === "-")) {
        this.position += 1;
        left = { kind: "binary", op: token.op, left, right: this.term() };
        continue;
      }
      return left;
    }
  }

  private term(): Node {
    let left = this.factor();
    for (;;) {
      const token = this.peek();
      if (token?.kind === "op" && (token.op === "*" || token.op === "/")) {
        this.position += 1;
        const right = this.factor();
        if (token.op === "/" && right.kind === "number" && right.value === 0) {
          throw new ExpressionError("Dividing by zero can never produce a number.", token.offset);
        }
        left = { kind: "binary", op: token.op, left, right };
        continue;
      }
      return left;
    }
  }

  private factor(): Node {
    const token = this.peek();
    if (token?.kind === "op" && token.op === "-") {
      this.position += 1;
      return { kind: "unary", op: "-", operand: this.factor() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();
    if (!token) {
      throw new ExpressionError("Expected a line item, a number or a bracket.", this.endOffset());
    }

    if (token.kind === "number") {
      this.position += 1;
      return { kind: "number", value: token.value };
    }

    if (token.kind === "ident") {
      this.position += 1;
      return { kind: "ident", name: token.name };
    }

    if (token.kind === "lparen") {
      this.position += 1;
      const inner = this.expression();
      const closing = this.peek();
      if (closing?.kind !== "rparen") {
        throw new ExpressionError("Expected a closing ) for this bracket.", closing?.offset ?? this.endOffset());
      }
      this.position += 1;
      return inner;
    }

    throw new ExpressionError(
      `Expected a line item, a number or a bracket, found "${token.text}".`,
      token.offset,
    );
  }
}

export function parseExpression(input: string): ParseResult {
  try {
    if (input.trim() === "") return { ok: false, error: { message: "The expression is empty.", offset: 0 } };
    const tokens = tokenise(input);
    const node = new Parser(tokens, input.length).parse();
    return { ok: true, node };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { ok: false, error: { message: error.message, offset: error.offset } };
    }
    throw error;
  }
}

/** Every identifier the expression references, deduplicated, in the order they appear. */
export function identifiers(node: Node): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  function walk(current: Node): void {
    switch (current.kind) {
      case "ident":
        if (!seen.has(current.name)) {
          seen.add(current.name);
          out.push(current.name);
        }
        return;
      case "unary":
        walk(current.operand);
        return;
      case "binary":
        walk(current.left);
        walk(current.right);
        return;
      case "number":
        return;
    }
  }

  walk(node);
  return out;
}

export type Resolve = (name: string) => number | undefined;

export type EvalResult =
  | { kind: "ok"; value: number }
  | { kind: "unavailable"; missing: string[] }
  | { kind: "undefined_denominator"; reason: "zero" | "negative" }
  | { kind: "not_a_number" };

export interface EvaluateOptions {
  /**
   * Set for ratios where a negative denominator makes the result actively misleading:
   * ROE on negative equity reads as a strong return and means the opposite.
   */
  positiveDenominator?: boolean;
}

/**
 * Evaluates the tree, collecting every missing identifier before giving up.
 *
 * A missing input outranks a degenerate denominator: telling the user a figure is missing
 * is actionable, telling them the denominator is zero when the numerator was never there
 * sends them to the wrong cell.
 */
export function evaluate(node: Node, resolve: Resolve, opts: EvaluateOptions = {}): EvalResult {
  const missing: string[] = [];
  // Held in an object because TypeScript's control-flow analysis does not track a `let`
  // that only ever changes inside the closure below.
  const degenerate: { reason: "zero" | "negative" | null } = { reason: null };

  function walk(current: Node): number {
    switch (current.kind) {
      case "number":
        return current.value;
      case "ident": {
        const value = resolve(current.name);
        if (value === undefined || Number.isNaN(value)) {
          if (!missing.includes(current.name)) missing.push(current.name);
          return 0;
        }
        return value;
      }
      case "unary":
        return -walk(current.operand);
      case "binary": {
        const left = walk(current.left);
        const right = walk(current.right);
        switch (current.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/": {
            // Zero within rounding noise is zero: a denominator of 0.4 against a numerator
            // in the millions produces a number nobody should read.
            if (closeEnough(right, 0) || right === 0) {
              degenerate.reason ??= "zero";
              return 0;
            }
            if (opts.positiveDenominator && right < 0) {
              degenerate.reason ??= "negative";
              return 0;
            }
            return left / right;
          }
        }
      }
    }
  }

  const value = walk(node);

  if (missing.length > 0) return { kind: "unavailable", missing };
  if (degenerate.reason) return { kind: "undefined_denominator", reason: degenerate.reason };
  if (!Number.isFinite(value)) return { kind: "not_a_number" };
  return { kind: "ok", value };
}

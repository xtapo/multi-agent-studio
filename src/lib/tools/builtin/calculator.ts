import type { AgentTool } from "@/types/tool";
import { AppError } from "@/lib/errors";

/**
 * Deterministic arithmetic.
 *
 * Implemented as a hand-written recursive-descent parser rather than eval() or
 * `new Function()`. An LLM decides the input string here, so this is an
 * untrusted-code path by definition; a parser that only understands numbers and
 * five operators cannot be turned into remote code execution.
 */
type Token = { type: "num"; value: number } | { type: "op"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9._]/.test(input[i])) num += input[i++];
      const value = Number(num.replace(/_/g, ""));
      if (Number.isNaN(value)) throw new AppError("TOOL_FAILURE", `Invalid number "${num}".`);
      tokens.push({ type: "num", value });
      continue;
    }
    if ("+-*/%^()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new AppError("TOOL_FAILURE", `Unsupported character "${ch}" in expression.`);
  }
  return tokens;
}

function parse(tokens: Token[]): number {
  let pos = 0;

  const peek = () => tokens[pos];
  const eat = (op: string) => {
    const t = peek();
    if (t && t.type === "op" && t.value === op) {
      pos++;
      return true;
    }
    return false;
  };

  // primary := number | "(" expr ")" | ("+"|"-") primary
  function primary(): number {
    if (eat("-")) return -primary();
    if (eat("+")) return primary();
    if (eat("(")) {
      const v = expr();
      if (!eat(")")) throw new AppError("TOOL_FAILURE", "Missing closing parenthesis.");
      return v;
    }
    const t = peek();
    if (!t || t.type !== "num") throw new AppError("TOOL_FAILURE", "Expected a number.");
    pos++;
    return t.value;
  }

  // power := primary ("^" power)?   — right associative
  function power(): number {
    const base = primary();
    if (eat("^")) return base ** power();
    return base;
  }

  // term := power (("*"|"/"|"%") power)*
  function term(): number {
    let value = power();
    for (;;) {
      if (eat("*")) value *= power();
      else if (eat("/")) {
        const d = power();
        if (d === 0) throw new AppError("TOOL_FAILURE", "Division by zero.");
        value /= d;
      } else if (eat("%")) {
        const d = power();
        if (d === 0) throw new AppError("TOOL_FAILURE", "Modulo by zero.");
        value %= d;
      } else return value;
    }
  }

  // expr := term (("+"|"-") term)*
  function expr(): number {
    let value = term();
    for (;;) {
      if (eat("+")) value += term();
      else if (eat("-")) value -= term();
      else return value;
    }
  }

  const result = expr();
  if (pos !== tokens.length) throw new AppError("TOOL_FAILURE", "Unexpected trailing input in expression.");
  return result;
}

export const calculatorTool: AgentTool<{ expression: string }, { expression: string; result: number }> = {
  name: "calculator",
  displayName: "Calculator",
  description:
    "Evaluate an arithmetic expression exactly. Supports + - * / % ^ and parentheses. Use this instead of doing mental math — never estimate numbers yourself.",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: 'Arithmetic expression, e.g. "(1200 * 0.18) + 45"' },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  async execute(input) {
    const expression = String(input?.expression ?? "").slice(0, 500);
    if (!expression.trim()) throw new AppError("TOOL_FAILURE", "expression is required.");
    const result = parse(tokenize(expression));
    if (!Number.isFinite(result)) throw new AppError("TOOL_FAILURE", "Expression did not evaluate to a finite number.");
    return { expression, result };
  },
};

type ScannerState = {
  depth: number;
  quote: "'" | '"' | "`" | "]" | null;
  lineComment: boolean;
  blockComment: boolean;
};

function isWordChar(value: string | undefined) {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function stripTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;\s*$/, "").trim();
}

function advanceScannerState(sql: string, index: number, state: ScannerState) {
  const char = sql[index];
  const next = sql[index + 1];

  if (state.lineComment) {
    if (char === "\n") {
      state.lineComment = false;
    }
    return index;
  }

  if (state.blockComment) {
    if (char === "*" && next === "/") {
      state.blockComment = false;
      return index + 1;
    }
    return index;
  }

  if (state.quote) {
    if (state.quote === "'" && char === "'" && next === "'") {
      return index + 1;
    }
    if (state.quote === '"' && char === '"' && next === '"') {
      return index + 1;
    }
    if (char === state.quote) {
      state.quote = null;
    }
    return index;
  }

  if (char === "-" && next === "-") {
    state.lineComment = true;
    return index + 1;
  }
  if (char === "/" && next === "*") {
    state.blockComment = true;
    return index + 1;
  }
  if (char === "'" || char === '"' || char === "`") {
    state.quote = char;
    return index;
  }
  if (char === "[") {
    state.quote = "]";
    return index;
  }
  if (char === "(") {
    state.depth += 1;
    return index;
  }
  if (char === ")" && state.depth > 0) {
    state.depth -= 1;
  }
  return index;
}

function matchesKeyword(sql: string, index: number, keyword: string) {
  if (sql.slice(index, index + keyword.length).toLowerCase() !== keyword) {
    return false;
  }
  return !isWordChar(sql[index - 1]) && !isWordChar(sql[index + keyword.length]);
}

function matchesOrderBy(sql: string, index: number) {
  if (!matchesKeyword(sql, index, "order")) {
    return false;
  }
  const rest = sql.slice(index + "order".length);
  const whitespace = rest.match(/^\s+/)?.[0] ?? "";
  const byIndex = index + "order".length + whitespace.length;
  return whitespace.length > 0 && matchesKeyword(sql, byIndex, "by");
}

function scanTopLevel(sql: string, predicate: (index: number) => boolean) {
  const state: ScannerState = { depth: 0, quote: null, lineComment: false, blockComment: false };
  for (let index = 0; index < sql.length; index += 1) {
    if (!state.quote && !state.lineComment && !state.blockComment && state.depth === 0 && predicate(index)) {
      return index;
    }
    index = advanceScannerState(sql, index, state);
  }
  return -1;
}

export function hasTopLevelCompoundOperator(sql: string) {
  return (
    scanTopLevel(sql, (index) => matchesKeyword(sql, index, "union") || matchesKeyword(sql, index, "intersect") || matchesKeyword(sql, index, "except")) >= 0
  );
}

export function rewriteCompoundOrderByForSqlite(sql: string) {
  const trimmed = stripTrailingSemicolon(sql);
  if (!trimmed || !hasTopLevelCompoundOperator(trimmed)) {
    return null;
  }

  const orderByIndex = scanTopLevel(trimmed, (index) => matchesOrderBy(trimmed, index));
  if (orderByIndex < 0) {
    return null;
  }

  const body = trimmed.slice(0, orderByIndex).trim();
  const orderBy = trimmed.slice(orderByIndex).trim();
  if (!body || !orderBy) {
    return null;
  }

  return `select * from (${body}) as cycle_probe_compound_order ${orderBy}`;
}

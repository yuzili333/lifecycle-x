type ScannerState = {
  depth: number;
  quote: "'" | '"' | "`" | "]" | null;
  lineComment: boolean;
  blockComment: boolean;
};

function isWordChar(value: string | undefined) {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function isIdentifierChar(value: string | undefined) {
  return value !== undefined && /[\p{L}\p{N}_$]/u.test(value);
}

function readQuotedIdentifier(sql: string, startIndex: number) {
  const opening = sql[startIndex];
  const closing = opening === "[" ? "]" : opening;
  let value = "";
  for (let index = startIndex + 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (character !== closing) {
      value += character;
      continue;
    }
    if (sql[index + 1] === closing && opening !== "[") {
      value += closing;
      index += 1;
      continue;
    }
    return { closed: true, endIndex: index, value };
  }
  return { closed: false, endIndex: sql.length - 1, value };
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

export function quoteKnownIdentifiersForSqlite(sql: string, identifiers: string[]) {
  const candidates = Array.from(new Set(identifiers.map((identifier) => identifier.trim()).filter(Boolean)))
    .sort((left, right) => right.length - left.length);
  if (!sql.trim() || candidates.length === 0) return sql;

  const state: ScannerState = { depth: 0, quote: null, lineComment: false, blockComment: false };
  let output = "";
  for (let index = 0; index < sql.length; index += 1) {
    if (!state.quote && !state.lineComment && !state.blockComment) {
      const identifier = candidates.find((candidate) => {
        if (!sql.startsWith(candidate, index)) return false;
        const previous = sql[index - 1];
        const following = sql[index + candidate.length];
        return !(isIdentifierChar(candidate[0]) && isIdentifierChar(previous)) &&
          !(isIdentifierChar(candidate[candidate.length - 1]) && isIdentifierChar(following));
      });
      if (identifier) {
        output += `"${identifier.replaceAll('"', '""')}"`;
        index += identifier.length - 1;
        continue;
      }
    }

    const nextIndex = advanceScannerState(sql, index, state);
    output += sql.slice(index, nextIndex + 1);
    index = nextIndex;
  }
  return output;
}

export function rewriteTopLevelAliasSourceForSqlite(sql: string, alias: string, tableName: string) {
  const normalizedAlias = alias.trim();
  const normalizedTableName = tableName.trim();
  if (
    !sql.trim() ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedAlias) ||
    !normalizedTableName
  ) {
    return null;
  }

  const fromIndex = scanTopLevel(sql, (index) => matchesKeyword(sql, index, "from"));
  if (fromIndex < 0) return null;

  let sourceStart = fromIndex + "from".length;
  while (/\s/.test(sql[sourceStart] ?? "")) sourceStart += 1;
  const sourceMatch = sql.slice(sourceStart).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  if (!sourceMatch || sourceMatch.toLowerCase() !== normalizedAlias.toLowerCase()) {
    return null;
  }

  const sourceEnd = sourceStart + sourceMatch.length;
  if (isIdentifierChar(sql[sourceEnd])) return null;
  const suffix = sql.slice(sourceEnd);
  const nextToken = suffix.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1]?.toLowerCase();
  const allowedNextTokens = new Set([
    "where",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "group",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "intersect",
    "except",
  ]);
  if (nextToken && !allowedNextTokens.has(nextToken)) return null;

  const quotedTableName = `"${normalizedTableName.replaceAll('"', '""')}"`;
  return `${sql.slice(0, sourceStart)}${quotedTableName} AS ${normalizedAlias}${suffix}`;
}

function isEmptyQuotedIdentifierContext(sql: string, startIndex: number, opening: string) {
  if (opening !== '"') return true;
  const prefix = sql.slice(0, startIndex).trimEnd();
  return prefix.endsWith(".") || /\b(?:from|join|as)\s*$/i.test(prefix);
}

export function sqliteSqlStructureIssue(sql: string) {
  if (!sql.trim()) return "SQL 不能为空。";

  const state: ScannerState = { depth: 0, quote: null, lineComment: false, blockComment: false };
  for (let index = 0; index < sql.length; index += 1) {
    if (!state.quote && !state.lineComment && !state.blockComment && (sql[index] === '"' || sql[index] === "`" || sql[index] === "[")) {
      const token = readQuotedIdentifier(sql, index);
      if (!token.closed) {
        return "SQL 包含未闭合的标识符引号。";
      }
      if (!token.value.trim() && isEmptyQuotedIdentifierContext(sql, index, sql[index])) {
        return "SQL 包含空字段名或空表名。";
      }
      index = token.endIndex;
      continue;
    }
    index = advanceScannerState(sql, index, state);
  }
  return null;
}

export function sqlReferencesIdentifier(sql: string, identifier: string) {
  const expected = identifier.trim();
  if (!expected) return false;

  const state: ScannerState = { depth: 0, quote: null, lineComment: false, blockComment: false };
  for (let index = 0; index < sql.length; index += 1) {
    if (!state.quote && !state.lineComment && !state.blockComment) {
      const character = sql[index];
      if (character === '"' || character === "`" || character === "[") {
        const token = readQuotedIdentifier(sql, index);
        if (token.closed && token.value === expected) return true;
        index = token.endIndex;
        continue;
      }
      if (sql.startsWith(expected, index)) {
        const previous = sql[index - 1];
        const following = sql[index + expected.length];
        if (!isIdentifierChar(previous) && !isIdentifierChar(following)) return true;
      }
    }
    index = advanceScannerState(sql, index, state);
  }
  return false;
}

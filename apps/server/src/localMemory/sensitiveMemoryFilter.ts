import type { SensitiveFilterResult } from "./types.js";

type Issue = SensitiveFilterResult["issues"][number];

export type SensitiveMemoryFilterConfig = {
  maskEmails?: boolean;
  blockRawTableData?: boolean;
};

const API_KEY_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{12,})["']?/gi,
];
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9_./+=-]{12,})/gi;
const TOKEN_PATTERN = /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|token)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{12,})["']?/gi;
const PASSWORD_FIELD_PATTERN = /\b(password|passwd|pwd|db_password)\s*[:=]\s*["']?([^"'\s,;]{3,})["']?/gi;
const DB_URL_PATTERN = /\b(?:mysql|postgres(?:ql)?|mariadb|mongodb|redis):\/\/[^\s"'<>]+/gi;
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s]+)@/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:OPENSSH|RSA|DSA|EC|PRIVATE) PRIVATE KEY-----[\s\S]+?-----END (?:OPENSSH|RSA|DSA|EC|PRIVATE) PRIVATE KEY-----/g;
const ENV_LINE_PATTERN = /(?:^|\n)\s*(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*)\s*=\s*[^\n]+/g;
const CN_PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CN_ID_PATTERN = /(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
const BANK_CARD_PATTERN = /(?<!\d)(?:\d[ -]?){16,19}(?!\d)/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export class SensitiveMemoryFilter {
  private readonly config: Required<SensitiveMemoryFilterConfig>;

  constructor(config: SensitiveMemoryFilterConfig = {}) {
    this.config = {
      maskEmails: config.maskEmails ?? false,
      blockRawTableData: config.blockRawTableData ?? true,
    };
  }

  filter(content: string): SensitiveFilterResult {
    const issues: Issue[] = [];
    let safeContent = content;
    let action: SensitiveFilterResult["action"] = "none";

    if (PRIVATE_KEY_PATTERN.test(safeContent)) {
      PRIVATE_KEY_PATTERN.lastIndex = 0;
      return {
        safeContent: "",
        action: "blocked",
        issues: [{ type: "ssh_private_key", severity: "critical", message: "检测到 SSH 私钥，已阻止写入 Memory。" }],
      };
    }
    PRIVATE_KEY_PATTERN.lastIndex = 0;

    if (this.config.blockRawTableData && looksLikeRawTableData(safeContent)) {
      return {
        safeContent: "",
        action: "blocked",
        issues: [{ type: "raw_table_data", severity: "critical", message: "检测到疑似大量源表行数据，已阻止写入 Memory。" }],
      };
    }

    for (const pattern of API_KEY_PATTERNS) {
      safeContent = safeContent.replace(pattern, (...args: string[]) => {
        issues.push({ type: "api_key", severity: "critical", message: "检测到 API Key，已脱敏。" });
        action = "masked";
        if (args.length > 3 && args[1] && args[2]) {
          return `${args[1]}=[MASKED_API_KEY]`;
        }
        return "[MASKED_API_KEY]";
      });
    }

    safeContent = safeContent
      .replace(BEARER_PATTERN, () => {
        issues.push({ type: "bearer_token", severity: "critical", message: "检测到 Bearer Token，已脱敏。" });
        action = "masked";
        return "Bearer [MASKED_TOKEN]";
      })
      .replace(TOKEN_PATTERN, (_match, key: string) => {
        issues.push({ type: "token", severity: "critical", message: "检测到 Token，已脱敏。" });
        action = "masked";
        return `${key}=[MASKED_TOKEN]`;
      })
      .replace(DB_URL_PATTERN, () => {
        issues.push({ type: "database_connection_string", severity: "critical", message: "检测到数据库连接串，已脱敏。" });
        action = "masked";
        return "[MASKED_DATABASE_CONNECTION_STRING]";
      })
      .replace(URL_CREDENTIAL_PATTERN, (_match, prefix: string) => {
        issues.push({ type: "url_credentials", severity: "critical", message: "检测到 URL 中的账号密码，已脱敏。" });
        action = "masked";
        return `${prefix}[MASKED_CREDENTIALS]@`;
      })
      .replace(PASSWORD_FIELD_PATTERN, (_match, key: string) => {
        issues.push({ type: "password", severity: "critical", message: "检测到密码字段，已脱敏。" });
        action = "masked";
        return `${key}=[MASKED_PASSWORD]`;
      })
      .replace(ENV_LINE_PATTERN, (match) => {
        issues.push({ type: "env_secret", severity: "critical", message: "检测到 .env 敏感配置，已脱敏。" });
        action = "masked";
        return match.includes("\n") ? "\n[MASKED_ENV_SECRET]" : "[MASKED_ENV_SECRET]";
      })
      .replace(CN_ID_PATTERN, () => {
        issues.push({ type: "cn_id_number", severity: "error", message: "检测到身份证号，已脱敏。" });
        action = "masked";
        return "[MASKED_ID_NUMBER]";
      })
      .replace(CN_PHONE_PATTERN, () => {
        issues.push({ type: "phone_number", severity: "warning", message: "检测到手机号，已脱敏。" });
        action = "masked";
        return "[MASKED_PHONE]";
      })
      .replace(BANK_CARD_PATTERN, (match) => {
        const digits = match.replace(/\D/g, "");
        if (digits.length < 16 || digits.length > 19) {
          return match;
        }
        issues.push({ type: "bank_card", severity: "error", message: "检测到银行卡号，已脱敏。" });
        action = "masked";
        return "[MASKED_BANK_CARD]";
      });

    if (this.config.maskEmails) {
      safeContent = safeContent.replace(EMAIL_PATTERN, () => {
        issues.push({ type: "email", severity: "info", message: "检测到邮箱地址，已脱敏。" });
        action = "masked";
        return "[MASKED_EMAIL]";
      });
    }

    return { safeContent, action, issues: dedupeIssues(issues) };
  }
}

function looksLikeRawTableData(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.length > 20 && parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return true;
    }
  } catch {
    // Plain text and markdown are checked below.
  }
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length > 30) {
    const delimited = lines.filter((line) => line.split(/,|\t|\|/).length >= 6).length;
    return delimited / lines.length > 0.7;
  }
  return false;
}

function dedupeIssues(issues: Issue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

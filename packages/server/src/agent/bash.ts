/** Bash ツールに渡されたコマンドを、承認の要否を決めるために分類する */

export type CommandClass = "allow" | "ask" | "deny";

export interface ParsedCommand {
  /** `&&` で区切られた各コマンドの単語 */
  segments: string[][];
  /** パイプ、`;`、リダイレクト、変数展開、コマンド置換などを含む */
  complex: boolean;
}

const SHELL_META = new Set([";", "|", "&", "<", ">", "(", ")", "$", "`", "\n", "{", "}", "*", "?", "~"]);

/** シェルの単語分割を簡易的に行う。`&&` 以外の、引用符の外にあるメタ文字は complex として扱う */
export function parseCommand(command: string): ParsedCommand {
  const segments: string[][] = [[]];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;
  let complex = false;
  const endToken = () => {
    if (inToken) segments.at(-1)!.push(current);
    current = "";
    inToken = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "$" || ch === "`" || ch === "\\") complex = true;
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
    } else if (ch === " " || ch === "\t") {
      endToken();
    } else if (ch === "&" && command[i + 1] === "&") {
      endToken();
      segments.push([]);
      i++;
    } else {
      if (SHELL_META.has(ch) || ch === "\\") complex = true;
      current += ch;
      inToken = true;
    }
  }
  if (quote) complex = true;
  endToken();
  // `a && && b` や末尾の `&&` は正しいコマンドではない
  if (segments.some((tokens) => tokens.length === 0)) complex = true;
  return { segments, complex };
}

/** 承認なしで実行してよいコマンド（先頭の語とサブコマンド） */
const ALLOWED: Record<string, Set<string> | null> = {
  npm: new Set(["install", "i", "ci", "update", "up", "test", "t", "ls", "list", "audit", "outdated", "view", "why", "explain", "run"]),
  pnpm: new Set(["install", "i", "update", "up", "test", "t", "ls", "list", "audit", "outdated", "why", "run"]),
  yarn: new Set(["install", "upgrade", "up", "test", "list", "why", "audit", "outdated", "run"]),
  pip: new Set(["install", "list", "show", "freeze"]),
  pip3: new Set(["install", "list", "show", "freeze"]),
  pytest: null,
  git: new Set(["status", "diff", "log", "show", "add", "commit", "rev-parse", "ls-files"]),
  ls: null,
  pwd: null,
};

/** `npm run` などで承認なしに実行してよいスクリプト名 */
const ALLOWED_SCRIPTS = new Set(["build", "test", "lint", "typecheck", "check"]);

/** 作業ディレクトリの外に影響しうるオプション */
const RISKY_FLAG = /^(-g|--global|--prefix|--location|--user|--target|-C|--git-dir|--work-tree|--exec-path|--registry|--index-url|--extra-index-url|--output)(=|$)/;
const PARENT_DIR = /(^|[/:=])\.\.([/]|$)/;

/** `git -C dir -c k=v push` のようにオプションが前に付いても、サブコマンドを取り出す */
function gitSubcommand(tokens: string[]): string | undefined {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "-C" || t === "-c" || t === "--git-dir" || t === "--work-tree") i++;
    else if (!t.startsWith("-")) return t;
  }
  return undefined;
}

function classifyTokens(tokens: string[]): { decision: CommandClass; reason: string } {
  const [program, sub, script] = tokens;
  if (program === "git" && gitSubcommand(tokens) === "push") {
    return { decision: "deny", reason: PUSH_DENIED };
  }
  if (!program || !Object.hasOwn(ALLOWED, program)) return { decision: "ask", reason: "許可リストにないコマンド" };
  const subs = ALLOWED[program];
  if (subs && (!sub || !subs.has(sub))) return { decision: "ask", reason: "許可リストにないサブコマンド" };
  if (sub === "run" && !(script && ALLOWED_SCRIPTS.has(script))) return { decision: "ask", reason: "許可リストにないスクリプト" };
  if (tokens.some((t) => RISKY_FLAG.test(t))) return { decision: "ask", reason: "作業ディレクトリの外に影響しうるオプション" };
  if (tokens.some((t) => t.startsWith("/") || PARENT_DIR.test(t))) {
    return { decision: "ask", reason: "作業ディレクトリの外を指すパス" };
  }
  return { decision: "allow", reason: "許可リストにあるコマンド" };
}

const PUSH_DENIED = "git push は使えません。push と PR の作成は create_pull_request ツールで行ってください。";

/** `&&` でつないだ場合は、すべてのコマンドが許可リストにあるときだけ自動で許可する */
export function classifyCommand(command: string): { decision: CommandClass; reason: string } {
  const { segments, complex } = parseCommand(command);
  if (complex) {
    // 複雑なコマンドは中身を正確に読めないため、git と push が両方現れたら拒否する
    if (/\bgit\b[\s\S]*\bpush\b/.test(command)) return { decision: "deny", reason: PUSH_DENIED };
    return { decision: "ask", reason: "パイプやリダイレクトなどを含むコマンド" };
  }
  const results = segments.map(classifyTokens);
  return results.find((r) => r.decision === "deny") ?? results.find((r) => r.decision === "ask") ?? results[0]!;
}

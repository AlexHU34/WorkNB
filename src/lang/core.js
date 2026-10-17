/* Ядро BloomScript: лексер, парсер, интерпретатор, окружения.
 * Файл общий для редактора (lang.html) и приложения (index.html),
 * поэтому здесь не должно быть ни DOM, ни игрового состояния —
 * всё внешнее приходит через объект host.
 * Фаза 0.3. Не редактировать вручную: переносить из lang.html нечего,
 * правки идут сюда и проверяются tools/lang-tests.py.
 */
class LangError extends Error {
  constructor(msg, line) { super(msg); this.line = line; }
}


/* === ПОДСКАЗКИ К ОШИБКАМ ===
 *
 * Само сообщение об ошибке не меняем: оно точное, и на нём завязаны
 * проверки качества. Подсказка — отдельная строка после сообщения,
 * потому что новичку нужно не «что не так», а «что делать».
 *
 * Правило пишется одно на ошибку. Порядок важен: первое подходящее
 * выигрывает, поэтому более общие формулировки идут ниже.
 */
const ERR_HELP = [
  [/отступ.*не совпадает/i,
   "Блоки отмечаются отступом. Проверь, что каждая строка внутри блока сдвинута на 2 пробела вправо, а следующая строка после блока — назад."],
  [/не закрыт/i,
   "После открывающей скобки или кавычки обязана быть закрывающая. Обычно теряется одна скобка в конце."],
  [/фигурные скобки не нужны/i,
   "В этом языке блоки задаются отступом, а не скобками { }. Убери фигурные скобки и выровняй строки отступом."],
  [/неизвестн/i,
   "Такой команды нет. Открой раздел «Справка» и найди похожую по названию — скорее всего, опечатка в имени."],
  [/ожида/i,
   "На этом месте интерпретатор ждал другое. Посмотри на предыдущую строку: скорее всего, забыта запятая или скобка."],
  [/объявлен/i,
   "Имя уже занято. Переименуй переменную или функцию — и во всех местах, где она используется."],
  [/превышен лимит/i,
   "Слишком много работы за один кадр. Убери бесконечный цикл или уменьши число шагов в нём."],
];

function errHelp(message) {
  const m = String(message || "");
  for (const [re, text] of ERR_HELP) {
    if (re.test(m)) return text;
  }
  return "";
}
const KEYWORDS = new Set(["let","const","fn","class","extends","new","this","super",
  "return","if","else","elif","while","for","in","break","continue","true","false","null",
  "and","or","not","try","catch","finally","throw","import","as","static",
  "enum","typeof"]);
const OPS2 = ["..<","===","!==","==","!=","<=",">=","&&","||","+=","-=","*=","/=","%=",".."];
const OPS1 = "+-*/%()[];,.=<>!?:".split("");
const ASSIGN_OPS = ["=", "+=", "-=", "*=", "/=", "%="];

function isIdCh(c) { return /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127; }

/* Блоки задаются отступами, как в Python. Лексер сам выдаёт
   NL (перевод строки), INDENT (заход в блок) и DEDENT (выход). */
function tokenize(src) {
  const T = [], n = src.length;
  let i = 0, line = 1;
  const indents = [0];
  const push = (type, val) => T.push({ type, val, line });
  let atLineStart = true;

  /* перевод строки перед первым токеном новой содержательной строки */
  const newline = () => {
    if (T.length) push("nl", "\n");
  };
  const applyIndent = (col) => {
    const top = indents[indents.length - 1];
    if (col > top) { indents.push(col); push("indent", col); }
    else if (col < top) {
      while (indents.length > 1 && indents[indents.length - 1] > col) {
        indents.pop();
        push("dedent", col);
      }
      if (indents[indents.length - 1] !== col) {
        throw new LangError("отступ " + col + " не совпадает с блоком выше", line);
      }
    }
  };

  while (i < n) {
    const c = src[i];

    if (c === "\r") { i++; continue; }

    if (c === "\n") {
      line++;
      i++;
      atLineStart = true;
      continue;
    }

    if (atLineStart) {
      /* считаем отступ; пустые строки и строки-комментарии его не меняют */
      let col = 0;
      while (i < n && (src[i] === " " || src[i] === "\t")) {
        col += src[i] === "\t" ? 4 : 1;
        i++;
      }
      if (i >= n) break;
      if (src[i] === "\n") { i++; line++; continue; }
      if (src[i] === "\r") { i++; continue; }
      if (src[i] === "/" && (src[i+1] === "/" || src[i+1] === "*")) {
        /* комментарий в начале строки: отступ не учитываем */
        if (src[i+1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
        const start = line; i += 2;
        while (i + 1 < n && !(src[i] === "*" && src[i+1] === "/")) {
          if (src[i] === "\n") { line++; atLineStart = true; }
          i++;
        }
        if (i + 1 >= n) throw new LangError("не закрыт /* */", start);
        i += 2;
        continue;
      }
      newline();
      applyIndent(col);
      atLineStart = false;
      continue;
    }

    if (c === " " || c === "\t") { i++; continue; }
    /* комментарии */
    if (c === "/" && src[i+1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i+1] === "*") {
      const start = line; i += 2;
      while (i + 1 < n && !(src[i] === "*" && src[i+1] === "/")) { if (src[i] === "\n") { line++; atLineStart = true; } i++; }
      if (i + 1 >= n) throw new LangError("не закрыт /* */", start);
      i += 2; continue;
    }
    /* строки */
    if (c === '"' || c === "'") {
      const q = c, st = line; i++;
      let s = "";
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") {
          i++;
          const e = src[i];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"'
             : e === "'" ? "'" : "\\" + e;
        } else { if (src[i] === "\n") throw new LangError("перенос строки в строке", line); s += src[i]; }
        i++;
      }
      if (i >= n) throw new LangError("не закрыта строка", st);
      i++; push("str", s); continue;
    }
    /* числа */
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i+1]))) {
      let s = "";
      while (i < n && /[0-9_]/.test(src[i])) { if (src[i] !== "_") s += src[i]; i++; }
      if (src[i] === "." && /[0-9]/.test(src[i+1])) { s += src[i++]; while (i < n && /[0-9_]/.test(src[i])) { if (src[i] !== "_") s += src[i]; i++; } }
      if (src[i] === "e" || src[i] === "E") {
        let save = i; s += src[i++];
        if (src[i] === "+" || src[i] === "-") s += src[i++];
        if (!/[0-9]/.test(src[i] || "")) { i = save; }
        else while (i < n && /[0-9]/.test(src[i])) s += src[i++];
      }
      push("num", parseFloat(s)); continue;
    }
    /* идентификаторы и ключевые слова */
    if (isIdCh(c) && !/[0-9]/.test(c)) {
      let s = "";
      while (i < n && isIdCh(src[i])) s += src[i++];
      push(KEYWORDS.has(s) ? "kw" : "id", s);
      continue;
    }
    /* операторы */
    let op = null;
    for (const o of OPS2) if (src.startsWith(o, i)) { op = o; break; }
    if (!op && OPS1.indexOf(c) >= 0) op = c;
    if (op) { push("op", op); i += op.length; continue; }
    if (c === "{") throw new LangError("фигурные скобки не нужны — блок задаётся отступом", line);
    if (c === "}") throw new LangError("фигурные скобки не нужны — блок задаётся отступом", line);
    throw new LangError("непонятный символ «" + c + "»", line);
  }
  if (T.length && T[T.length - 1].type !== "nl") newline();
  while (indents.length > 1) { indents.pop(); push("dedent", 0); }
  push("eof", null);
  return T;
}

/* ================================================================== ПАРСЕР */
/* Блоки — по отступу, как в Python. Скобки { } в языке запрещены.
   Объект записывается круглыми скобками: (hp: 3, name: "ёж") */
const PREC = { "||":1,"or":1, "&&":2,"and":2, "==":3,"!=":3,"===":3,"!==":3,
  "<":4,">":4,"<=":4,">=":4, "+":5,"-":5, "*":6,"/":6,"%":6 };

function parse(src) {
  const T = tokenize(src);
  let p = 0;
  const peek = () => T[p];
  const at = v => T[p].val === v && (T[p].type === "op" || T[p].type === "kw");
  const kind = () => T[p].type;
  const eat = v => { if (!at(v)) return false; p++; return true; };
  const need = v => { if (!at(v)) throw new LangError("ожидалось «" + v + "», а стоит «" + peek().val + "»", peek().line); p++; };
  const line = () => T[p].line;
  /* конец строки: `;` можно опускать */
  const atEol = () => kind() === "nl" || kind() === "dedent" || kind() === "eof" ||
    at(";") || at(":") || at("else") || at("elif") || at("catch") || at("finally");
  const endLine = () => { let n = 0; while (kind() === "nl") { p++; n++; } return n; };
  const expectEol = (what) => {
    if (at(";")) { p++; endLine(); return; }
    if (kind() === "nl") { endLine(); return; }
    if (kind() === "dedent" || kind() === "eof") return;
    throw new LangError("после «" + what + "» ожидался конец строки, а стоит «" + peek().val + "»", peek().line);
  };
  /* оператор не может начинаться с голого числа или строки — это продолжение выражения */
  const startsStmt = () => {
    const t = T[p];
    if (t.type === "kw" || t.type === "id") return true;
    return at("(") || at("[") || at("-") || at("!") || at("not") || at("+");
  };
  /* хвост блока: после вложенного блока dedent уже съеден */
  const blockTail = (what) => {
    if (at(";")) { p++; endLine(); return; }
    if (kind() === "nl") { endLine(); return; }
    if (kind() === "dedent" || kind() === "eof") return;
    if (startsStmt()) return;
    throw new LangError("после «" + what + "» ожидался конец строки, а стоит «" + peek().val + "»", peek().line);
  };
  /* тело блока: после «:» идёт отступ и statements до dedent */
  const body = () => {
    const ln = line();
    need(":");
    /* однострочное тело: if x: print(1) */
    if (!atEol()) {
      const stmts = [stmt()];
      if (at(";")) p++;
      return { t: "block", stmts: stmts, line: ln };
    }
    expectEol("блок");
    if (kind() !== "indent") {
      /* пустое тело допустимо только если дальше идёт dedent/eof/else/elif */
      if (kind() === "dedent" || kind() === "eof" || at("else") || at("elif") || at("catch") || at("finally")) {
        return { t: "block", stmts: [{ t: "nop", line: ln }], line: ln };
      }
      throw new LangError("тело блока должно быть с отступом (4 пробела)", ln);
    }
    p++;
    const stmts = [];
    while (kind() !== "dedent" && kind() !== "eof") {
      if (kind() === "nl") { endLine(); continue; }
      stmts.push(stmt());
      if (at(";")) p++;
      if (kind() === "nl") { endLine(); continue; }
      if (kind() === "dedent" || kind() === "eof") break;
      if (startsStmt()) continue;
      throw new LangError("после оператора ожидался конец строки, а стоит «" + peek().val + "»", peek().line);
    }
    if (kind() === "dedent") p++;
    return { t: "block", stmts: stmts, line: ln };
  };

  function expr(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.type !== "op" && !(t.type === "kw" && (t.val === "and" || t.val === "or"))) break;
      const pr = PREC[t.val];
      if (pr === undefined || pr < min) break;
      p++;
      const right = expr(pr + 1);
      left = { t: "bin", op: t.val, a: left, b: right, line: t.line };
    }
    /* тернарный оператор: cond ? a : b */
    if (min <= 1 && at("?")) {
      const ln = T[p].line;
      p++;
      const a = expr(1);
      need(":");
      const b = expr(1);
      return { t: "ternary", cond: left, a: a, b: b, line: ln };
    }
    return left;
  }

  function unary() {
    const t = peek();
    if (at("-") || at("!") || at("not") || at("+")) {
      p++;
      return { t: "un", op: t.val === "not" ? "!" : t.val, a: unary(), line: t.line };
    }
    return postfix();
  }

  function postfix() {
    let node = primary();
    for (;;) {
      if (at("(")) {
        const ln = line(); p++;
        const args = [];
        if (!at(")")) { do { args.push(expr(1)); } while (eat(",")); }
        need(")");
        node = { t: "call", callee: node, args: args, line: ln };
        continue;
      }
      if (at("[")) {
        const ln = line(); p++;
        const idx = expr(1);
        need("]");
        node = { t: "index", obj: node, idx: idx, line: ln };
        continue;
      }
      if (at(".")) {
        const ln = line(); p++;
        const nm = peek();
        if (nm.type !== "id" && nm.type !== "kw") throw new LangError("после точки ожидалось имя", nm.line);
        p++;
        node = { t: "member", obj: node, name: nm.val, line: ln };
        continue;
      }
      break;
    }
    return node;
  }

  function primary() {
    const t = peek();
    if (t.type === "num") { p++; return { t: "num", v: t.val, line: t.line }; }
    if (t.type === "str") { p++; return { t: "str", v: t.val, line: t.line }; }
    if (t.type === "kw") {
      if (t.val === "true") { p++; return { t: "bool", v: true, line: t.line }; }
      if (t.val === "false") { p++; return { t: "bool", v: false, line: t.line }; }
      if (t.val === "null") { p++; return { t: "null", v: null, line: t.line }; }
      if (t.val === "fn") return funcExpr();
      if (t.val === "if" || t.val === "while" || t.val === "for") return stmt();
      if (t.val === "new") {
        const ln = t.line; p++;
        const nm = peek();
        if (nm.type !== "id") throw new LangError("после new ожидалось имя класса", nm.line);
        p++;
        let args = [];
        if (eat("(")) {
    if (!at(")")) { do { if (at(")")) break; args.push(expr(1)); } while (eat(",")); }
          need(")");
        }
        return { t: "new", cls: nm.val, args: args, line: ln };
      }
      if (t.val === "this") { p++; return { t: "this", line: t.line }; }
      if (t.val === "super") { p++; return { t: "super", line: t.line }; }
      if (t.val === "typeof") { p++; return { t: "typeof", a: unary(), line: t.line }; }
    }
    if (t.type === "id") { p++; return { t: "id", name: t.val, line: t.line }; }
    if (at("(")) {
      p++;
      /* объект: (a: 1, b: 2) */
      if (peek().type === "id" && T[p + 1] && T[p + 1].val === ":") {
        const ln = line();
        const props = [];
        if (!at(")")) {
          do {
            if (at(")")) break;
            const k = peek();
            if (k.type !== "id" && k.type !== "kw") throw new LangError("ожидалось имя поля", k.line);
            p++; need(":");
            props.push({ k: k.val, v: expr(1) });
          } while (eat(","));
        }
        need(")");
        return { t: "obj", props: props, line: ln };
      }
      const e = expr(1);
      need(")");
      return e;
    }
    if (at("[")) {
      const ln = line(); p++;
      const items = [];
      if (!at("]")) { do { if (at("]")) break; items.push(expr(1)); } while (eat(",")); }
      need("]");
      return { t: "arr", items: items, line: ln };
    }
    throw new LangError("неожиданный токен «" + (t.val === null ? "конец файла" : t.val) + "»", t.line);
  }

  /* ------------------------------------------------------------- КЛАССЫ */
  /* class Имя [extends База]: поля и fn-методы по отступу */
  function classDecl() {
    const ln = line(); need("class");
    const nm = peek();
    if (nm.type !== "id") throw new LangError("после class ожидалось имя", nm.line);
    p++;
    let base = null;
    if (eat("extends")) {
      const b = peek();
      if (b.type !== "id") throw new LangError("после extends ожидалось имя класса", b.line);
      p++;
      base = b.val;
    }
    need(":");
    if (kind() !== "nl" && kind() !== "eof") throw new LangError("после class ...: ожидался перенос строки", peek().line);
    endLine();
    if (kind() !== "indent") throw new LangError("тело класса " + nm.val + " должно быть с отступом", ln);
    p++;
    const fields = [], methods = [], statics = [];
    while (kind() !== "dedent" && kind() !== "eof") {
      if (kind() === "nl") { endLine(); continue; }
      if (at("static")) {
        p++;
        const m = peek();
        if (m.type !== "id") throw new LangError("после static ожидалось имя метода", m.line);
        p++;
        const s = signature();
        statics.push({ t: "fn", name: m.val, params: s.params, body: s.body, line: m.line });
        continue;
      }
      if (t_isFn()) { methods.push(funcDecl()); continue; }
      const f = peek();
      if (f.type !== "id") throw new LangError("в классе ожидалось поле или fn", f.line);
      p++;
      let init = { t: "num", v: 0, line: f.line };
      if (eat("=")) init = expr(1);
      fields.push({ name: f.val, init: init });
      expectEol("поле");
    }
    if (kind() === "dedent") p++;
    return { t: "classdecl", name: nm.val, base: base, fields: fields, methods: methods, statics: statics, line: ln };
  }
  function t_isFn() { const t = peek(); return t.type === "kw" && t.val === "fn"; }

  /* enum Имя: A, B = 7, C  — значения на своих строках */
  function enumDecl() {
    const ln = line(); need("enum");
    const nm = peek();
    if (nm.type !== "id") throw new LangError("после enum ожидалось имя", nm.line);
    p++;
    need(":");
    if (kind() !== "nl" && kind() !== "eof") throw new LangError("после enum ...: ожидался перенос строки", peek().line);
    endLine();
    if (kind() !== "indent") throw new LangError("тело enum " + nm.val + " должно быть с отступом", ln);
    p++;
    const items = [];
    while (kind() !== "dedent" && kind() !== "eof") {
      if (kind() === "nl") { endLine(); continue; }
      const k = peek();
      if (k.type !== "id" && k.type !== "kw") throw new LangError("в enum ожидалось имя", k.line);
      p++;
      items.push({ name: k.val, value: eat("=") ? expr(1) : null });
      expectEol("элемент enum");
    }
    if (kind() === "dedent") p++;
    return { t: "enumdecl", name: nm.val, items: items, line: ln };
  }

  /* import "модуль.bs" as Имя   |   import Имя from "модуль.bs" */
  function importDecl() {
    const ln = line(); need("import");
    let alias = null, path = null;
    if (at("(") ) throw new LangError("import: скобки не поддерживаются", ln);
    if (peek().type === "id" && T[p + 1] && T[p + 1].val === "from") {
      alias = peek().val; p += 2;
      const q = peek();
      if (q.type !== "str") throw new LangError("после from ожидалось имя файла в кавычках", q.line);
      p++;
      path = q.val;
    } else {
      const q = peek();
      if (q.type !== "str") throw new LangError("ожидалось имя файла в кавычках", q.line);
      p++;
      path = q.val;
      if (eat("as")) {
        if (eat("*")) {
          alias = "*";
        } else {
          const a = peek();
          if (a.type !== "id") throw new LangError("после as ожидалось имя или *", a.line);
          p++;
          alias = a.val;
        }
      }
    }
    if (!alias) alias = path.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    return { t: "import", path: path, alias: alias, line: ln };
  }

  function tryStmt() {
    const ln = line(); need("try");
    const b1 = body();
    let param = null, handler = null, fin = null;
    if (eat("catch")) {
      if (eat("(")) {
        const nm = peek();
        if (nm.type !== "id") throw new LangError("в catch ожидалось имя", nm.line);
        p++;
        param = nm.val;
        need(")");
        handler = body();
      } else if (peek().type === "id") {
        param = peek().val;
        p++;
        handler = body();
      } else {
        handler = body();
      }
    }
    if (eat("finally")) fin = body();
    if (!handler && !fin) throw new LangError("после try нужен catch или finally", ln);
    return { t: "try", body: b1, param: param, handler: handler, fin: fin, line: ln };
  }

  function signature() {
    need("(");
    const params = [];
    if (!at(")")) {
      do {
        if (at(")")) break;
        const q = peek();
        if (q.type !== "id") throw new LangError("ожидалось имя параметра", q.line);
        p++;
        let def = null;
        if (eat("=")) def = expr(1);
        params.push({ name: q.val, def: def });
      } while (eat(","));
    }
    need(")");
    return { params: params, body: body() };
  }
  /* fn имя(...) {...} — определение; fn имя — ссылка на уже объявленную;
     fn (...) {...} — анонимная функция. */
  function funcExpr() {
    const ln = line(); need("fn");
    const nm = peek();
    if (nm.type === "id") {
      p++;
      if (!at("(")) return { t: "fnref", name: nm.val, line: ln };
      const s = signature();
      return { t: "fn", name: nm.val, params: s.params, body: s.body, line: ln };
    }
    const s = signature();
    return { t: "fn", name: null, params: s.params, body: s.body, line: ln };
  }
  function funcDecl() {
    const ln = line(); need("fn");
    const nm = peek();
    if (nm.type !== "id") throw new LangError("после fn ожидалось имя функции", nm.line);
    p++;
    const s = signature();
    return { t: "fndecl", name: nm.val, params: s.params, body: s.body, line: ln };
  }

  /* Устаревшее имя: блоки теперь строит body() */
  function block() { return body(); }

  /* Условие: if a > b:   или   if (a > b): */
  function cond() {
    if (eat("(")) { const c = expr(1); need(")"); return c; }
    return expr(1);
  }

  function stmt() {
    const t = peek();
    if (at("let") || at("const")) {
      const ln = line(); p++;
      const names = [];
      for (;;) {
        const nm = peek();
        if (nm.type !== "id") throw new LangError("после let ожидалось имя", nm.line);
        p++;
        let val = { t: "num", v: 0, line: ln };
        if (eat("=")) val = expr(1);
        names.push({ name: nm.val, init: val });
        if (!eat(",")) break;
      }
      return { t: "decls", list: names, konst: t.val === "const", line: ln };
    }
    if (t.type === "kw" && t.val === "fn") return funcDecl();
    if (at("class")) return classDecl();
    if (at("import")) return importDecl();
    if (at("throw")) { const ln = line(); p++; return { t: "throw", v: expr(1), line: ln }; }
    if (at("try")) return tryStmt();
    if (at("enum")) return enumDecl();
    if (at("if")) {
      const ln = line(); p++;
      const c = cond();
      const then = body();
      let els = null;
      /* elif/else могут стоять на следующей строке */
      let save = p;
      endLine();
      if (at("elif")) {
        p++;
        const el = line();
        const c2 = cond();
        const th2 = body();
        els = { t: "if", cond: c2, then: th2, els: null, line: el };
        save = p;
        endLine();
        if (eat("else")) els.els = body();
      } else if (at("else")) {
        p++;
        els = body();
      } else {
        p = save;
      }
      return { t: "if", cond: c, then: then, els: els, line: ln };
    }
    if (at("else") || at("elif")) {
      throw new LangError((t.val === "else" ? "else" : "elif") + " без парного if", t.line);
    }
    if (at("return")) {
      const ln = line(); p++;
      if (atEol()) return { t: "ret", v: null, line: ln };
      return { t: "ret", v: expr(1), line: ln };
    }
    if (at("while")) {
      const ln = line(); p++;
      const c = cond();
      return { t: "while", cond: c, body: body(), line: ln };
    }
    if (at("for")) {
      const ln = line(); p++;
      const nm = peek();
      if (nm.type !== "id") throw new LangError("после for ожидалось имя переменной", nm.line);
      p++; need("in");
      /* for x in массив — обход элементов */
      const save = p;
      let seq = null;
      try { seq = expr(1); } catch (e) { seq = null; }
      if (seq && !(at("..") || at("..<") || at(",")) && atEol()) {
        return { t: "foreach", name: nm.val, seq: seq, body: body(), line: ln };
      }
      p = save;
      const from = expr(1);
      let inclusive = true;
      if (eat("..<")) inclusive = false;
      else if (!(eat("..") || eat(","))) throw new LangError("ожидалось «..» или «..<» в цикле for", peek().line);
      const to = expr(1);
      return { t: "for", name: nm.val, from: from, to: to, incl: inclusive, body: body(), line: ln };
    }
    if (at("break")) { p++; return { t: "break", line: t.line }; }
    if (at("continue")) { p++; return { t: "continue", line: t.line }; }
    if (at(";")) { p++; return { t: "nop", line: t.line }; }

    /* присваивание: сначала пробуем разобрать левую часть целиком */
    const ln = line();
    const start = p;
    let e;
    try {
      e = expr(1);
    } catch (err) {
      p = start;
      throw err;
    }
    if (peek().type === "op" && ASSIGN_OPS.indexOf(peek().val) >= 0) {
      const op = peek().val; p++;
      return { t: "assign", target: e, op: op, value: expr(1), line: ln };
    }
    return { t: "expr", v: e, line: ln };
  }

  const prog = [];
  while (kind() !== "eof" && kind() !== "dedent") {
    if (kind() === "nl") { endLine(); continue; }
    prog.push(stmt());
    if (at(";")) p++;
    if (kind() === "nl") { endLine(); continue; }
    if (kind() === "eof" || kind() === "dedent") break;
    if (startsStmt()) continue;
    throw new LangError("после оператора ожидался конец строки, а стоит «" + peek().val + "»", peek().line);
  }
  return prog;
}

/* =========================================================== ИНТЕРПРЕТАТОР */
const BREAK = { sig: "break" }, CONTINUE = { sig: "continue" };
const RET = v => ({ sig: "ret", v });

class Env {
  constructor(parent) { this.vars = new Map(); this.parent = parent; }
  get(k) { let e = this; while (e) { if (e.vars.has(k)) return e.vars.get(k); e = e.parent; } return undefined; }
  has(k) { let e = this; while (e) { if (e.vars.has(k)) return true; e = e.parent; } return false; }
  set(k, val) {
    let e = this;
    while (e) { if (e.vars.has(k)) { const s = e.vars.get(k); e.vars.set(k, { v: val, c: !!s.c, __slot: 1 }); return; } e = e.parent; }
    this.vars.set(k, { v: val, c: false, __slot: 1 });
  }
  declare(k, val, konst) { this.vars.set(k, { v: val, c: !!konst, __slot: 1 }); }
}

function truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 0;
  return true;
}

/* Имена, через которые программа может выбраться из песочницы. */
const FORBIDDEN_MEMBERS = {
  "__proto__": 1, "prototype": 1, "constructor": 1,
  "__defineGetter__": 1, "__defineSetter__": 1,
  "__lookupGetter__": 1, "__lookupSetter__": 1
};

/* Текущий интерпретатор — нужен хелперам методов коллекций (map, filter,
     forEach...): им не передают ссылку на интерпретатор, а вызывают колбэк
     синхронно из тела программы.

     Раньше здесь стояло «первый созданный за всю жизнь интерпретатор».
     Это ломалось, как только интерпретаторов становилось больше одного
     (игра в редакторе + игра в приложении): счётчик шагов списывался
     не на тот счётчик, cykl в map() уходил не в ту переменную окружения,
     а бесконечный цикл в чужой игре вообще не ловился — свой счётчик не
     рос. Теперь это тот, кто исполняется прямо сейчас. */
let I0 = null;

/* Монотонные часы. performance.now() точнее и не прыгает при переводе
   системного времени; Date.now() оставлен запасным для сред без performance. */
const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? function () { return performance.now(); }
  : function () { return Date.now(); };

class Interp {
  constructor(host) {
    this.maxDepth = 200;        /* предел вложенных вызовов функций */
    this.maxObjects = 1000000;   /* предел объектов и данных на один запуск */
    this.maxMs = 12;             /* предел времени на кадр, мс */
    this.deadline = 0;           /* момент, когда кадр обязан завершиться; 0 = выключено */
    this.host = host;        /* интерфейс к движку/UI */
    this.globals = new Env(null);
    this.steps = 0;
    this.maxSteps = 400000;
    this.curEnv = null;
    this.curLine = 0;
    this.modules = {};
    this.depth = 0;
    this.objects = 0;
    this.overCount = 0;
  }

  /* Счётчики обнуляются на верхнем уровне запуска. Иначе между кадрами они
     копятся и любая игра падает на «превышен объём данных», хотя каждый кадр
     создавал немного. Часы здесь не запускаются: их ставит startClock перед
     кадром, чтобы программа, вызванная вне игрового цикла, не падала по
     устаревшему дедлайну. */
  resetLimits() {
    this.depth = 0;
    this.objects = 0;
    this.overCount = 0;
    this.deadline = 0;
  }

  /* Старт отсчёта кадра. Лимит шагов не ловит программу, где шагов мало,
     но каждый дорогой (сборка огромной строки одним выражением). Часы
     закрывают именно эту дыру. */
  startClock(ms) {
    this.deadline = nowMs() + (typeof ms === "number" ? ms : this.maxMs);
  }

  /* Вход в рекурсию. Нативный RangeError на глубокой рекурсии обрушивал
     страницу; теперь это понятная ошибка в языке. */
  enter() {
    if (++this.depth > this.maxDepth) {
      this.depth--;
      throw new LangError("слишком глубокая рекурсия: предел " +
        this.maxDepth + " уровней (похоже на бесконечный вызов)",
        this.curLine || 0);
    }
  }

  leave() { this.depth--; }

  /* Приблизительный размер структуры. Важно поймать «съел полгигабайта»,
     а не измерить точно. */
  guardSize(size) {
    this.objects += size || 1;
    if (this.objects > this.maxObjects) {
      throw new LangError("превышен объём данных: " + this.objects +
        " объектов (предел " + this.maxObjects +
        ") — вероятно, цикл без конца", this.curLine || 0);
    }
  }

  /* Лимит шагов. Раньше перед броском счётчик обнулялся, и программа вида

       while true:
           try:
               spin()
           catch e:
               continue

   ловила ошибку, продолжала, и лимит срабатывал снова — вечно. Теперь
   счётчик не обнуляется: после предела каждая следующая проверка тоже
   бросает, программа обязана развернуться. А если пользователь ловит
   ошибку по кругу (try/catch вокруг while), через несколько повторов
   бросается обычный Error — его `catch`, который ловит только LangError,
   уже не проглотит. */
  budget() {
    if (++this.steps > this.maxSteps) {
      this.overCount++;
      if (this.overCount > 3) {
        const e = new Error("выполнение остановлено: лимит шагов превышен повторно");
        e.fatal = true;
        throw e;
      }
      throw new LangError("превышен лимит шагов — похоже на бесконечный цикл", this.curLine || 0);
    }
    /* Часы проверяем не каждый шаг — performance.now() на каждом шаге съел бы
       сам бюджет, — а раз в 1024 шага. Этого достаточно: 1024 шага не могут
       занять больше миллисекунд, а дорогой шаг всё равно упрётся в проверку
       рядом. */
    if (this.deadline !== 0 && (this.steps & 1023) === 0 && nowMs() > this.deadline) {
      this.overCount++;
      if (this.overCount > 3) {
        const e = new Error("выполнение остановлено: кадр слишком тяжёлый");
        e.fatal = true;
        throw e;
      }
      throw new LangError("превышено время кадра — программа слишком тяжёлая", this.curLine || 0);
    }
  }

  run(ast, env) {
    const prev = this.curEnv;
    const prevI0 = I0;
    this.curEnv = env;
    I0 = this;
    try {
      for (const s of ast) {
        const r = this.exec(s, env);
        if (r && r.sig) return r;
      }
      return null;
    } finally {
      this.curEnv = prev;
      I0 = prevI0;
    }
  }

  exec(n, env) {
    this.curLine = n.line || this.curLine;
    switch (n.t) {
      case "nop": return null;
      case "num": case "str": return n.v; case "bool": return n.v;
      case "null": return null;
      case "block": { const e = new Env(env); return this.run(n.stmts, e); }
      case "decl": this.budget(); env.declare(n.name, this.eval(n.init, env), n.konst); return null;
      case "decls":
        this.budget();
        for (const d of n.list) env.declare(d.name, this.eval(d.init, env), n.konst);
        return null;
      case "expr": this.budget(); this.eval(n.v, env); return null;
      case "assign": this.budget(); this.assign(n, env); return null;
      case "if":
        this.budget();
        return truthy(this.eval(n.cond, env)) ? this.exec(n.then, env) : (n.els ? this.exec(n.els, env) : null);
      case "while":
        for (;;) {
          this.budget();
          if (!truthy(this.eval(n.cond, env))) break;
          const r = this.exec(n.body, env);
          if (r === BREAK) break;
          if (r === CONTINUE) continue;
          if (r && r.sig === "ret") return r;
        }
        return null;
      case "for": {
        const from = this.eval(n.from, env), to = this.eval(n.to, env);
        /* границы цикла не должны вычисляться, если цикл пуст */
        if (!(from <= (n.incl === false ? to : to + 1))) return null;
        const e = new Env(env);
        if (n.name) e.declare(n.name, from, false);
        const end = n.incl === false ? to : to + 1;
        for (let i = from; i < end; i++) {
          this.budget();
          if (n.name) e.vars.set(n.name, { v: i, c: false, __slot: 1 });
          const r = this.exec(n.body, e);
          if (r === BREAK) break;
          if (r && r.sig === "ret") return r;
        }
        return null;
      }
      case "foreach": {
        const seq = this.eval(n.seq, env);
        let list;
        if (Array.isArray(seq)) list = seq;
        else if (typeof seq === "string") list = seq.split("");
        else if (seq && typeof seq === "object") list = Object.keys(seq).map(k => seq[k]);
        else throw new LangError("for in: обходить можно только массив, строку или объект", n.line);
        for (let i = 0; i < list.length; i++) {
          this.budget();
          const e = new Env(env);
          e.declare(n.name, list[i], false);
          e.declare("i", i, false);
          const r = this.exec(n.body, e);
          if (r === BREAK) break;
          if (r && r.sig === "ret") return r;
        }
        return null;
      }
      case "break": return BREAK;
      case "continue": return CONTINUE;
      case "ret": this.budget(); return RET(this.eval(n.v, env));
      case "fndecl": env.declare(n.name, { __fn: n, env: env }, false); return null;
      case "classdecl": env.declare(n.name, this.makeClass(n, env), false); return null;
      case "enumdecl": {
        const obj = { __enum: 1, __names: [] };
        let next = 0;
        for (const it of n.items) {
          const v = it.value ? this.eval(it.value, env) : next;
          obj[it.name] = v;
          obj.__names.push(it.name);
          next = v + 1;
        }
        env.declare(n.name, obj, true);
        return null;
      }
      case "import": {
        const mod = this.host.loadModule(n.path, n.line);
        if (n.alias === "*") {
          /* import "x.bs" as * — всё в текущую область */
          for (const k in mod.exports) {
            const s = env.get(k);
            env.declare(k, s && s.__slot === 1 ? s.v : mod.exports[k], false);
          }
        } else {
          env.declare(n.alias, mod.exports, false);
        }
        return null;
      }
      case "throw": this.budget(); throw new LangThrow(this.eval(n.v, env), n.line);
      case "try": {
        let r = null;
        try {
          r = this.exec(n.body, env);
        } catch (e) {
          if (e instanceof LangThrow || e instanceof LangError) {
            if (n.handler) {
              const e2 = new Env(env);
              if (n.param) e2.declare(n.param, e instanceof LangThrow ? e.value : new HostError(String(e.message), e.line), false);
              r = this.exec(n.handler, e2);
            } else if (!n.fin) {
              throw e;
            }
          } else throw e;
        }
        if (n.fin) {
          const fr = this.exec(n.fin, env);
          if (fr && fr.sig === "ret") return fr;
        }
        return r;
      }
      default: return this.eval(n, env);
    }
  }

  /* Строит объект класса: прототипная цепочка через Object.create. */
  makeClass(n, env) {
    const base = n.base ? slotValue(env.get(n.base)) : null;
    if (n.base && (!base || base.__cls === undefined)) {
      throw new LangError("неизвестный базовый класс «" + n.base + "»", n.line);
    }
    const baseProto = base ? base.__proto : null;
    const proto = baseProto ? Object.create(baseProto) : {};
    proto.__cls = n.name;
    proto.__defaults = Object.create(baseProto && baseProto.__defaults ? baseProto.__defaults : null);
    proto.__methods = Object.create(baseProto && baseProto.__methods ? baseProto.__methods : null);
    proto.__fields = Object.create(null);

    const cls = { __cls: n.name, __isClass: 1, __proto: proto, __base: base || null, __lexEnv: env };

    for (const f of n.fields) {
      proto.__defaults[f.name] = { init: f.init, env: env };
      proto.__fields[f.name] = 1;
    }
    for (const m of n.methods) {
      proto.__methods[m.name] = { __fn: m, env: env };
    }
    for (const s of n.statics) {
      cls[s.name] = { __fn: s, env: env };
    }
    return cls;
  }

  /* new: создаёт объект с прототипом класса и инициализирует поля по цепочке. */
  construct(cls, args, line) {
    if (!cls || cls.__isClass !== 1) throw new LangError("new: это не класс", line);
    /* инициализация полей по всей цепочке: база -> ... -> сам класс */
    const proto = cls.__proto;
    const obj = Object.create(proto);
    obj.__self = obj;
    const chain = [];
    let pr = proto;
    while (pr) { chain.unshift(pr); pr = Object.getPrototypeOf(pr); }
    for (const p2 of chain) {
      const defs = p2.__defaults;
      if (!defs) continue;
      /* идём от корня к потомку: поле потомка перекрывает поле базы */
      for (const k in defs) obj[k] = this.eval(defs[k].init, defs[k].env || cls.__lexEnv);
    }
    const ctor = proto.__methods && proto.__methods.constructor;
    if (ctor) {
      const bound = { __fn: ctor.__fn, env: ctor.env, self: obj, __superCall: true };
      this.invoke(bound, args.map(a => ({ t: "raw", v: a, line: line })), ctor.env, line, null);
    }
    return obj;
  }

  assign(n, env) {
    const val = this.eval(n.value, env);
    const t = n.target;
    if (t.t === "id") {
      if (!env.has(t.name)) throw new LangError("переменная «" + t.name + "» не объявлена", t.line);
      const slot = env.get(t.name);
      if (slot && slot.c) throw new LangError("нельзя менять const «" + t.name + "»", t.line);
      const cur = slot && slot.__slot === 1 ? slot.v : slot;
      env.set(t.name, n.op === "=" ? val : this.binop(n.op.slice(0, -1), cur, val, t.line));
      return null;
    }
    if (t.t === "index") {
      const obj = this.eval(t.obj, env);
      const idx = this.eval(t.idx, env);
      /* Запись по индексу тоже идёт мимо песочницы: obj["__proto__"] = x
         переписывает прототип объекта, а obj["constructor"] = x кладёт
         в него функцию. Через это ломается всё остальное. */
      if (typeof idx === "string" && FORBIDDEN_MEMBERS[idx])
        throw new LangError("запись в «" + idx + "» запрещена", t.line);
      if (Array.isArray(obj)) { obj[idx] = n.op === "=" ? val : this.binop(n.op.slice(0, -1), obj[idx], val, t.line); return null; }
      if (obj && typeof obj === "object") { obj[idx] = n.op === "=" ? val : this.binop(n.op.slice(0, -1), obj[idx], val, t.line); return null; }
      throw new LangError("нельзя присвоить элемент — это не массив и не объект", t.line);
    }
    if (t.t === "member") {
      if (t.obj.t === "super") throw new LangError("super нельзя присвоить", t.line);
      const obj = this.eval(t.obj, env);
      if (obj && obj.__isClass) {
        if (n.op === "=") obj[t.name] = val;
        else obj[t.name] = this.binop(n.op.slice(0, -1), obj[t.name], val, t.line);
        return null;
      }
      if (obj && obj.__nat) {
        const allowed = ["x", "y", "z", "ry"];
        if (allowed.indexOf(t.name) < 0) throw new LangError("свойство «" + t.name + "» движка менять нельзя", t.line);
        const nv = n.op === "=" ? val : this.binop(n.op.slice(0, -1), obj[t.name], val, t.line);
        this.host.setNativeMember(obj, t.name, nv);
        return null;
      }
      if (obj && typeof obj === "object") {
        if (n.op === "=") obj[t.name] = val;
        else obj[t.name] = this.binop(n.op.slice(0, -1), obj[t.name], val, t.line);
        return null;
      }
      throw new LangError("нельзя присвоить свойство — «" + t.name + "»", t.line);
    }
    throw new LangError("слева от «" + n.op + "» должно быть имя, свойство или элемент", t.line);
  }

  eval(n, env) {
    if (!n) return null;              /* return без значения */
    switch (n.t) {
      case "num": case "str": return n.v; case "bool": return n.v;
      case "null": return null;
      case "id": {
        const v = env.get(n.name);
        if (v === undefined) throw new LangError("неизвестная переменная «" + n.name + "»", n.line);
        if (v && v.__slot === 1) return v.v;
        return v;
      }
      case "arr": this.guardSize(n.items.length); return n.items.map(i => this.eval(i, env));
      case "obj": { this.guardSize(n.props.length); const o = {}; for (const pr of n.props) o[pr.k] = this.eval(pr.v, env); return o; }
      case "un": {
        this.budget();
        const a = this.eval(n.a, env);
        return n.op === "-" ? -num(a, n.line) : n.op === "!" ? !truthy(a) : a;
      }
      case "bin": { this.budget(); return this.binop(n.op, this.eval(n.a, env), this.eval(n.b, env), n.line); }
      /* Песочница и для квадратных скобок. Раньше фильтр стоял только в
         readMember, то есть на точке: a.constructor ловился, а
         a["constructor"] проходил насквозь. Дальше ["constructor"]
         ["constructor"] даёт Function, а через неё — globalThis,
         document и всё остальное окружение страницы. */
      case "index": {
        this.budget();
        const o = this.eval(n.obj, env), i = this.eval(n.idx, env);
        if (typeof i === "string" && FORBIDDEN_MEMBERS[i])
          throw new LangError("доступ к «" + i + "» запрещён", n.line);
        return o === undefined ? undefined : o[i];
      }
      case "member": return this.member(n, env);
      case "call": return this.call(n, env);
      case "fn": return { __fn: n, env: env };
      case "fnref": {
        const v = env.get(n.name);
        if (v === undefined) throw new LangError("неизвестная функция «" + n.name + "»", n.line);
        return v && v.__slot === 1 ? v.v : v;
      }
      case "fndecl": { env.declare(n.name, { __fn: n, env: env }, false); return null; }
      case "new": {
        const cls = slotValue(env.get(n.cls));
        if (cls === undefined) throw new LangError("неизвестный класс «" + n.cls + "»", n.line);
        const args = (n.args || []).map(a => this.eval(a, env));
        return this.construct(cls, args, n.line);
      }
      case "this": {
        const s = env.get("this");
        if (!s || s.__slot !== 1) throw new LangError("this доступен только внутри метода класса", n.line);
        return s.v;
      }
      case "super": return { __super: true, __env: env, line: n.line };
      case "typeof": return typeOf(this.eval(n.a, env));
      case "ternary": return truthy(this.eval(n.cond, env)) ? this.eval(n.a, env) : this.eval(n.b, env);
      default: return this.exec(n, env);
    }
  }

  member(n, env) {
    const o = this.eval(n.obj, env);
    if (o === undefined || o === null) throw new LangError("у значения нет поля «" + n.name + "»", n.line);
    return this.readMember(o, n.name, n.line, n.obj);
  }

readMember(o, name, line, objNode) {
    if (o && o.__super) return this.superMember(name, o.__env || this.curEnv, line);
    if (o === null || o === undefined) throw new LangError("у значения нет поля «" + name + "»", line);
    /* песочница: не отдаём доступ к Function, прототипам и __proto__ */
    if (FORBIDDEN_MEMBERS[name]) throw new LangError("доступ к «" + name + "» запрещён", line);
    if (o.__nat) return this.host.nativeMember(o, name, line);
    if (o.__isClass) {
      if (name === "name") return o.__cls;
      const sm = o.__staticMethods;
      if (sm && sm[name]) return sm[name];
      if (o[name] !== undefined) return o[name];
      throw new LangError("у класса «" + o.__cls + "» нет «" + name + "»", line);
    }
    if (Array.isArray(o)) {
      if (name === "length") return o.length;
      /* отступаем к базовому типу, чтобы не попасть в Object.prototype */
      const am = arrayMethod(o, name);
      if (am !== undefined) return am;
      if (name in Array.prototype) {
        const f = Array.prototype[name];
        if (typeof f === "function") return f.bind(o);
      }
      return o[name];
    }
    if (typeof o === "string") {
      const sm = stringMethod(o, name);
      if (sm !== undefined) return sm;
      if (name in String.prototype && name !== "length") {
        const f = String.prototype[name];
        if (typeof f === "function") return f.bind(o);
      }
      return o[name];
    }
    if (o && o.__enum && name === "names") return o.__names;
    /* методы класса лежат в __methods по всей прототипной цепочке */
    if (o && o.__self !== undefined) {
      let pr = o;
      while (pr) {
        if (pr.__methods && pr.__methods[name]) return pr.__methods[name];
        pr = Object.getPrototypeOf(pr);
      }
      if (name in o) return o[name];
      throw new LangError("у объекта «" + (o.__clsName || "экземпляра") + "» нет «" + name + "»", line);
    }
    return o[name];
  }

  call(n, env) {
    this.budget();
    const c = n.callee;

    if (c.t === "callIndex") {
      const holder = this.eval(c.callee, env);
      const idx = this.eval(c.idx, env);
      const fnv = this.readMember(holder, idx, n.line, c.callee);
      const args = n.args.map(a => ({ t: "raw", v: this.eval(a, env), line: a.line }));
      return this.invoke(fnv, args, env, n.line, holder);
    }

    if (c.t === "super") {
      /* super(...) — вызов конструктора базового класса */
      const selfSlot = env.get("this");
      const self = selfSlot ? slotValue(selfSlot) : null;
      if (!self) throw new LangError("super доступен только внутри метода", n.line);
      let proto = Object.getPrototypeOf(self);
      while (proto && !(proto.__methods && proto.__methods.constructor)) proto = Object.getPrototypeOf(proto);
      if (!proto) throw new LangError("у класса нет базового конструктора", n.line);
      const ctor = proto.__methods.constructor;
      const bound = { __fn: ctor.__fn, env: ctor.env, self: self, __superCall: true };
      return this.invoke(bound, n.args, env, n.line, null);
    }

    if (c.t === "member") {
      const o = this.eval(c.obj, env);
      let f = this.member(c, env);
      if (o && o.__super) {
        /* super.метод(...) — this остаётся текущим объектом */
        return this.invoke(f, n.args, env, n.line, null);
      }
      if (o && o.__isClass && f && f.__fn) {
        /* статический метод класса: this = сам класс */
        const bound = { __fn: f.__fn, env: f.env, self: o };
        return this.invoke(bound, n.args, env, n.line, null);
      }
      if (f && f.__fn && (o === undefined || typeof o === "object")) {
        /* метод класса: this = объект */
        const bound = { __fn: f.__fn, env: f.env, self: o };
        return this.invoke(bound, n.args, env, n.line, null);
      }
      return this.invoke(f, n.args, env, n.line, o);
    }

    const f = this.eval(c, env);
    if (f && f.__isClass) throw new LangError("класс «" + f.__cls + "» нужно вызвать через new", n.line);
    return this.invoke(f, n.args, env, n.line, null);
  }

  invoke(f, argNodes, env, line, self) {
    this.budget();
    /* Игровой цикл (update/draw) зовёт invoke() напрямую, минуя run().
       Поэтому I0 ставится здесь же, а не только в run(): иначе вызов
       колбэка из map() смотрел бы на интерпретатор, оставшийся от
       чужого похода. */
    const prevI0 = I0;
    I0 = this;
    try {
      return this.invokeInner(f, argNodes, env, line, self);
    } finally {
      I0 = prevI0;
    }
  }

  invokeInner(f, argNodes, env, line, self) {
    const args = argNodes.map(a => (a && a.t === "raw") ? a.v : this.eval(a, env));
    if (typeof f === "function") return f.apply(self === null ? undefined : self, args);
    if (f && f.__fn) {
      /* Глубина считается только здесь. Раньше enter() стоял выше по
         тексту, и ветка нативной функции возвращалась мимо leave():
         счётчик только рос, и законная глубокая рекурсия (фракталы)
         упиралась в предел. */
      this.enter();
      const e = new Env(f.env);
      const params = f.__fn.params || [];
      params.forEach((pn, i) => {
        const name = typeof pn === "string" ? pn : pn.name;
        const def = typeof pn === "string" ? null : pn.def;
        if (args[i] !== undefined && args[i] !== null) { e.declare(name, args[i], false); return; }
        e.declare(name, def ? this.eval(def, f.env) : null, false);
      });
      if (f.self !== undefined) e.declare("this", f.self, false);
      e.declare("self", f.self !== undefined ? f.self : null, false);
      const prevLine = this.curLine;
      let r;
      try { r = this.run(f.__fn.body.stmts, e); }
      finally { this.leave(); this.curLine = prevLine; }
      if (r && r.sig === "ret") return r.v;
      return null;
    }
    throw new LangError("это не функция", line);
  }

  /* super.метод(...) — вызов метода базового класса на текущем this */
  superMember(name, env, line) {
    const selfSlot = env.get("this");
    const self = selfSlot ? slotValue(selfSlot) : null;
    if (!self) throw new LangError("super доступен только внутри метода", line);
    /* ищем начиная с базового класса: собственный прототип пропускаем */
    const ownProto = Object.getPrototypeOf(self);
    let proto = Object.getPrototypeOf(ownProto);
    while (proto) {
      if (proto.__methods && Object.prototype.hasOwnProperty.call(proto.__methods, name)) {
        const m = proto.__methods[name];
        return { __fn: m.__fn, env: m.env, self: self };
      }
      proto = Object.getPrototypeOf(proto);
    }
    throw new LangError("в базовом классе нет метода «" + name + "»", line);
  }

  binop(op, a, b, line) {
    switch (op) {
      case "+": return (typeof a === "string" || typeof b === "string")
        ? str(a) + str(b) : num(a, line) + num(b, line);
      case "-": return num(a, line) - num(b, line);
      case "*": return num(a, line) * num(b, line);
      case "/": { const d = num(b, line); if (d === 0) throw new LangError("деление на ноль", line); return num(a, line) / d; }
      case "%": { const d = num(b, line); if (d === 0) throw new LangError("остаток от деления на ноль", line); return num(a, line) % d; }
      case "==": case "===": return looseEq(a, b);
      case "!=": case "!==": return !looseEq(a, b);
      case "<": return num(a, line) < num(b, line);
      case ">": return num(a, line) > num(b, line);
      case "<=": return num(a, line) <= num(b, line);
      case ">=": return num(a, line) >= num(b, line);
      case "&&": case "and": return truthy(a) && truthy(b);
      case "||": case "or": return truthy(a) || truthy(b);
      default: throw new LangError("неизвестный оператор «" + op + "»", line);
    }
  }
}

class LangThrow extends Error {
  constructor(value, line) { super(typeof value === "string" ? value : "исключение"); this.value = value; this.line = line; }
}
class HostError {
  constructor(msg, line) { this.msg = msg; this.line = line; }
}

/* Методы массивов и строк. Собираются по факту чтения поля, поэтому
   возвращаем замыкание с уже захваченным объектом. */
function arrayMethod(o, name) {
  switch (name) {
    /* push добавляет ровно один элемент, поэтому в счётчик идёт 1, а не
       o.length. С o.length счётчик копился бы как 1+2+...+n и лимит
       памяти упирался бы где-то на полутора тысячах элементов — цикл,
       который честно кладёт в массив сто тысяч чисел, падал бы с враньём
       «превышен объём». */
    case "push": return v => { o.push(v); if (I0) I0.guardSize(1); return o.length; };
    case "pop": return () => (o.length ? o.pop() : null);
    case "shift": return () => (o.length ? o.shift() : null);
    case "unshift": return v => { o.unshift(v); return o.length; };
    case "first": return () => (o.length ? o[0] : null);
    case "last": return () => (o.length ? o[o.length - 1] : null);
    case "join": return sep => o.join(sep === undefined ? "," : str(sep));
    case "indexOf": return v => { const i = o.indexOf(v); return i < 0 ? -1 : i; };
    case "includes": return v => o.includes(v);
    case "reverse": return () => { o.reverse(); return o; };
    case "sort": return cmp => {
      if (cmp === undefined || cmp === null) o.sort((a, b) => (typeof a === "string" ? (a < b ? -1 : a > b ? 1 : 0) : a - b));
      else o.sort((a, b) => {
        const r = invokeAsNumber(cmp, [a, b]);
        if (typeof r === "boolean") return r ? -1 : 1;
        return typeof r === "number" ? r : 0;
      });
      return o;
    };
    case "map": return f => { const r = []; for (let i = 0; i < o.length; i++) r.push(invokeAsValue(f, [o[i], i])); return r; };
    case "filter": return f => { const r = []; for (let i = 0; i < o.length; i++) if (truthy(invokeAsValue(f, [o[i], i]))) r.push(o[i]); return r; };
    case "find": return f => { for (let i = 0; i < o.length; i++) if (truthy(invokeAsValue(f, [o[i], i]))) return o[i]; return null; };
    /* count — сколько элементов подходит под условие. Без него в коде
       приходилось писать reduce со счётчиком, а новичкам это неочевидно.
       Без аргумента считает все: a.count() — размер массива. */
    case "count": return f => {
      if (f === undefined || f === null) return o.length;
      let n = 0;
      for (let i = 0; i < o.length; i++) if (truthy(invokeAsValue(f, [o[i], i]))) n++;
      return n;
    };
    case "findIndex": return f => { for (let i = 0; i < o.length; i++) if (truthy(invokeAsValue(f, [o[i], i]))) return i; return -1; };
    case "some": return f => { for (let i = 0; i < o.length; i++) if (truthy(invokeAsValue(f, [o[i], i]))) return true; return false; };
    case "every": return f => { for (let i = 0; i < o.length; i++) if (!truthy(invokeAsValue(f, [o[i], i]))) return false; return true; };
    case "reduce": return (f, acc) => {
      let a = acc, start = 0;
      if (a === undefined) { if (!o.length) return null; a = o[0]; start = 1; }
      for (let i = start; i < o.length; i++) a = invokeAsValue(f, [a, o[i], i]);
      return a;
    };
    case "forEach": return f => { for (let i = 0; i < o.length; i++) invokeAsValue(f, [o[i], i]); return null; };
    case "slice": return (a, b) => o.slice(a === undefined ? 0 : num(a, 0), b === undefined ? undefined : num(b, 0));
    /* concat обязан учитывать память. Раньше лимит объёма стоял только на
     литералах, и `a = a.concat(a)` двадцать шесть раз подряд доходил до
     134 миллионов элементов, не потратив ни одного «объекта»: счётчик
     рос на 193 шага из 400 тысяч, и ни один лимит не срабатывал. */
  case "concat": return other => {
    const r = (Array.isArray(other) ? o.concat(other) : o.concat([other]));
    if (I0) I0.guardSize(r.length);
    return r;
  };
    case "clear": return () => { o.length = 0; return null; };
    case "removeAt": return i => { o.splice(num(i, 0), 1); return null; };
    default: return undefined;
  }
}

function stringMethod(s, name) {
  switch (name) {
    case "upper": return () => s.toUpperCase();
    case "lower": return () => s.toLowerCase();
    case "trim": return () => s.trim();
    /* split и replace тоже создают новые объекты, а раньше обходили счётчик.
       "a".split("") на длинной строке и replace с ростом результата
       раздували память без учёта — теперь объём результата идёт в тот же
       счётчик, что и concat. */
    case "split": return sep => {
      const r = s.split(sep === undefined ? "" : str(sep));
      if (I0) I0.guardSize(r.length);
      return r;
    };
    case "indexOf": return v => s.indexOf(str(v));
    case "lastIndexOf": return v => s.lastIndexOf(str(v));
    case "includes": return v => s.includes(str(v));
    case "startsWith": return v => s.startsWith(str(v));
    case "endsWith": return v => s.endsWith(str(v));
    case "slice": return (a, b) => s.slice(a === undefined ? 0 : num(a, 0), b === undefined ? undefined : num(b, 0));
    case "charAt": return i => (num(i, 0) >= 0 && num(i, 0) < s.length ? s[num(i, 0)] : "");
    case "at": return i => { const k = num(i, 0); return k >= 0 && k < s.length ? s[k] : ""; };
    case "replace": return (a, b) => {
      const r = s.split(str(a)).join(str(b));
      if (I0) I0.guardSize(r.length);
      return r;
    };
    /* repeat тоже должен стоить памяти: строка на 400 миллионов символов
     проходила молча, потому что счётчик объёма на это не смотрел. */
  case "repeat": return n => {
    const k = Math.max(0, num(n, 0));
    if (I0) I0.guardSize(k);
    return s.repeat(k);
  };
    case "padStart": return (n, c) => s.padStart(num(n, 0), c === undefined ? " " : str(c));
    case "padEnd": return (n, c) => s.padEnd(num(n, 0), c === undefined ? " " : str(c));
    case "length": return s.length;
    default: return undefined;
  }
}

function invokeAsValue(f, args) {
  if (!I0) return null;
  const nodes = args.map(v => ({ t: "raw", v: v, line: 0 }));
  return I0.invoke(f, nodes, I0.curEnv || null, 0, null);
}
function invokeAsNumber(f, args) {
  const v = invokeAsValue(f, args);
  return typeof v === "number" ? v : 0;
}

function num(v, line) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined) throw new LangError("ожидалось число, а получено пустое значение", line);
  if (typeof v === "string") { const f = parseFloat(v); if (!isNaN(f)) return f; }
  throw new LangError("ожидалось число, а получено " + typeOf(v), line);
}
function str(v) { return v === null || v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)); }
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "массив";
  if (v && v.__fn) return "функция";
  if (v && v.__nat) return "объект движка";
  return { number: "число", string: "строка", boolean: "истина/ложь", undefined: "ничего" }[typeof v] || typeof v;
}
/* Нестрогое равенство: 1 == "1" — истина, как в привычных языках. */
function looseEq(a, b) {
  const an = a === null || a === undefined ? null : typeof a;
  const bn = b === null || b === undefined ? null : typeof b;
  if (an === "boolean") return looseEq(a ? 1 : 0, b);
  if (bn === "boolean") return looseEq(a, b ? 1 : 0);
  const aNum = an === "number" ? a : (an === "string" && a.trim() !== "" && !isNaN(Number(a)) ? Number(a) : null);
  const bNum = bn === "number" ? b : (bn === "string" && b.trim() !== "" && !isNaN(Number(b)) ? Number(b) : null);
  if (aNum !== null && bNum !== null) return aNum === bNum;
  return a === b;
}

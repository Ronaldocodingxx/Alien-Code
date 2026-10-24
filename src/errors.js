// Diagnostics. Every compile error has a stable code (see docs/ERRORS.md),
// a position and an optional fix hint. Agents should key on `code`.

export class AlienError extends Error {
  constructor(code, msg, file, line, col, hint) {
    super(msg);
    this.code = code;
    this.file = file;
    this.line = line;
    this.col = col;
    this.hint = hint;
  }

  toJSON() {
    return { code: this.code, msg: this.message, file: this.file, line: this.line, col: this.col, hint: this.hint ?? null };
  }

  format(src) {
    let s = `${this.file}:${this.line}:${this.col}: error[${this.code}]: ${this.message}`;
    if (src) {
      const text = src.split("\n")[this.line - 1];
      if (text !== undefined) {
        const n = String(this.line);
        s += `\n ${n} | ${text.replace(/\t/g, " ")}\n ${" ".repeat(n.length)} | ${" ".repeat(Math.max(0, this.col - 1))}^`;
      }
    }
    if (this.hint) s += `\n  hint: ${this.hint}`;
    return s;
  }
}

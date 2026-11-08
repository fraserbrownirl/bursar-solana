/** ANSI colour for terminal output. Off when stdout is not a TTY or NO_COLOR is set. */
const on = () => process.stdout.isTTY === true && !("NO_COLOR" in process.env);

const wrap = (open: string) => (text: string) => (on() ? `\x1b[${open}m${text}\x1b[0m` : text);

export const boldGreen = wrap("1;32");
export const boldRed = wrap("1;31");
export const green = wrap("32");
export const amber = wrap("38;5;214");

/** Colour the verdict at the end of a decision line: APPROVE bold green, STOP… bold red. */
export function verdictLine(line: string): string {
  const stop = line.indexOf(" STOP");
  if (stop >= 0) return line.slice(0, stop + 1) + boldRed(line.slice(stop + 1));
  if (line.endsWith(" APPROVE")) return line.slice(0, -"APPROVE".length) + boldGreen("APPROVE");
  if (line.startsWith("STOP")) return boldRed(line);
  return line;
}

/** Colour the label of a check mark: live green, firmware amber. */
export function markLine(mark: string): string {
  return mark
    .replace("live (model, Mac)", green("live (model, Mac)"))
    .replace("firmware check (emulator)", amber("firmware check (emulator)"));
}

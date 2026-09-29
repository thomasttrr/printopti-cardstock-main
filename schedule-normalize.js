// The Sheeted Print Schedule can contain cells whose text wraps onto its own line
// (a long note in "Color Match", or a qty shown as `7` + `(1 copy)`). Copying the
// batch page turns that wrap into a real newline, so one record is split across two
// physical lines and the trailing half is parsed as its own short, bogus row.
// Re-join those continuation lines before the schedule parser sees the text.

// A real record starts with its 7-digit OL PO # in the first cell.
const DATA_ROW_RE = /^\s*\d{7}\b/;
// Anything else with a tab in it is either the next record or the "--- Same as
// Master ---" sub-block; neither continues the row above it.
const CONTINUATION_STOP_RE = /^\s*(\d{7}\b|---\s*Same as Master)/i;
// The "--- Same as Master ---" block and the quantity lines under it belong to the
// record above and must stay on their own lines.
const SAME_AS_MASTER_RE = /^\s*---\s*Same as Master/i;

function isDataRow(line) {
  return DATA_ROW_RE.test(line);
}

function isContinuation(line) {
  return line.indexOf("\t") !== -1 && !CONTINUATION_STOP_RE.test(line);
}

// How wide a finished record is, in cells. Measured from rows that were not split,
// because a copy trims trailing empty columns and the header can list more.
function expectedRowWidth(lines) {
  let width = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!isDataRow(lines[i])) continue;
    if (i + 1 < lines.length && isContinuation(lines[i + 1])) continue;
    width = Math.max(width, lines[i].split("\t").length);
  }
  return width;
}

// The rule engine adds 2 calibration sheets to every Qty Required (the Fiery
// allowance), so a plain qty `5` prints as 7 sheets on the sheet. A qty cell that
// says e.g. `1 (1 copy)` is different: it means "this job IS one copy", i.e. the
// printed number is already the exact sheet count, so no +2 may be added. Because
// the WASM is fixed, we pre-subtract: `n (…copy…)` becomes `max(n - 2, 0)` before
// the parser sees it, which nets out to exactly n on the pull sheet.
const COPY_QTY_RE = /\(\s*\d+\s*cop(?:y|ies)\s*\)/i;
const LEADING_NUM_RE = /^\s*(\d[\d,]*)/;

function stripFieryForCopies(cells, qtyIdx) {
  const rawQty = cells[qtyIdx] || "";
  if (!COPY_QTY_RE.test(rawQty)) return;
  const m = rawQty.match(LEADING_NUM_RE);
  if (!m) return;
  const exact = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(exact)) return;
  cells[qtyIdx] = String(Math.max(exact - 2, 0)) + rawQty.slice(m[0].length);
}

// Column positions come from the header, never hard-coded, so pastes with a
// different column set still work. The Qty Required column is found once per
// paste and applied to every record.
function qtyColumn(headerCells) {
  return headerCells.findIndex((c) => /^\s*qty\s*required\s*$/i.test(c));
}

function joinWrappedCells(lines) {
  const width = expectedRowWidth(lines);
  const qtyIdx = qtyColumn((lines.find((l) => /blank\s*product/i.test(l) && /qty\s*required/i.test(l)) || "").split("\t"));
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isDataRow(line) || !width) {
      out.push(line);
      continue;
    }
    const cells = line.split("\t");
    while (cells.length < width && i + 1 < lines.length && isContinuation(lines[i + 1])) {
      const cont = lines[i + 1].split("\t");
      const last = cells.pop() || "";
      const head = cont.shift() || "";
      cells.push(head ? (last ? last + " " + head : head) : last);
      for (const c of cont) cells.push(c);
      i += 1;
    }
    if (qtyIdx >= 0 && qtyIdx < cells.length) stripFieryForCopies(cells, qtyIdx);
    out.push(cells.join("\t"));
  }
  return out;
}

export function normalizeSchedule(text) {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  return joinWrappedCells(lines).join("\n");
}

export const __test__ = { isDataRow, isContinuation, expectedRowWidth, joinWrappedCells, SAME_AS_MASTER_RE };

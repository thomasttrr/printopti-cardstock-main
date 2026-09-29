import * as pdfjs from "./vendor/pdf.mjs";
import { PDFDocument } from "./vendor/pdf-lib.esm.min.js";
import init, { plan_order, pull_sheet } from "./pkg/printopti_wasm.js";
import { normalizeSchedule } from "./schedule-normalize.js";
import { clearSchedule, countJobs, loadSchedule, saveSchedule, SAVE } from "./schedule-store.js";

const MAX_SCHEDULE_CHARS = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 200 * 1024 * 1024;
// A paste is worth keeping the moment it lands; debounce so a 149-row paste doesn't
// hit localStorage on every keystroke.
const SAVE_DEBOUNCE_MS = 400;

pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";

const drop = document.querySelector("#drop");
const fileInput = document.querySelector("#file");
const fileName = document.querySelector("#file-name");
const schedule = document.querySelector("#schedule");
const sheet = document.querySelector("#sheet");
const clear = document.querySelector("#clear");
const savedNote = document.querySelector("#saved-note");
const go = document.querySelector("#go");
const status = document.querySelector("#status");
const unmapped = document.querySelector("#unmapped");
let pdfFile = null;
let ready = null;

function setStatus(message, isError) {
  status.textContent = message;
  status.className = isError ? "err" : "";
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function pdfTooLargeMessage(file) {
  const size = file && typeof file.size === "number" ? " (" + formatMB(file.size) + ")" : "";
  return "That PDF" + size + " is larger than the " + formatMB(MAX_PDF_BYTES) + " limit. Try a smaller or compressed PDF.";
}

function scheduleText() {
  const text = schedule.value;
  if (!text.trim()) {
    setStatus("Paste the Sheeted Print Schedule.", true);
    return null;
  }
  if (text.length > MAX_SCHEDULE_CHARS) {
    setStatus("The schedule is too large to read.", true);
    return null;
  }
  return normalizeSchedule(text);
}

// --- Local paste memory -------------------------------------------------------
// Keep the paste in this browser so a refresh or a closed tab can't cost a whole
// batch. Reaching for localStorage can itself throw (locked-down privacy modes), so
// resolve it once and treat "no storage available" as a supported state.
let pasteStore = null;
try {
  pasteStore = window.localStorage;
} catch (err) {
  pasteStore = null;
}

let saveTimer = 0;

function updateClearState() {
  if (clear) clear.disabled = !schedule.value.trim();
}

function noteSaved(status) {
  if (!savedNote) return;
  if (status === SAVE.OK) {
    const jobs = countJobs(schedule.value);
    savedNote.textContent =
      "Saved in this browser" + (jobs ? " · " + jobs + " jobs" : "") + " — survives a refresh. Nothing uploaded.";
  } else if (status === SAVE.TOO_LARGE) {
    savedNote.textContent = "This paste is too large to save locally — it will be lost if you refresh.";
  } else if (status === SAVE.UNAVAILABLE) {
    savedNote.textContent = "This browser is blocking local saves — the paste will be lost if you refresh.";
  } else {
    savedNote.textContent = "";
  }
}

function saveNow() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  noteSaved(saveSchedule(pasteStore, schedule.value));
}

function saveSoon() {
  updateClearState();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

function restorePaste() {
  const saved = loadSchedule(pasteStore);
  if (saved) {
    schedule.value = saved;
    const jobs = countJobs(saved);
    setStatus("Restored your last paste" + (jobs ? " (" + jobs + " jobs)" : "") + ". Clear it to start a new batch.");
    noteSaved(SAVE.OK);
  }
  updateClearState();
}

schedule.addEventListener("input", saveSoon);
schedule.addEventListener("blur", saveNow);
// Closing the tab inside the debounce window must not lose the last keystrokes.
window.addEventListener("pagehide", saveNow);
window.addEventListener("beforeunload", saveNow);

clear.addEventListener("click", () => {
  schedule.value = "";
  clearSchedule(pasteStore);
  unmapped.innerHTML = "";
  noteSaved(SAVE.EMPTY);
  setStatus("Cleared. Paste the next batch when you're ready.");
  updateClearState();
  schedule.focus();
});

restorePaste();

function takeFile(file) {
  if (!file) return false;
  if (file.size > MAX_PDF_BYTES) {
    pdfFile = null;
    fileName.textContent = "";
    setStatus(pdfTooLargeMessage(file), true);
    return false;
  }
  pdfFile = file;
  fileName.textContent = file.name + " (" + formatMB(file.size) + ")";
  setStatus("PDF ready: " + file.name + " (" + formatMB(file.size) + ").");
  return true;
}

fileInput.addEventListener("change", () => takeFile(fileInput.files[0]));
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("over");
  takeFile(event.dataTransfer.files[0]);
});

function pageText(content) {
  const lines = [];
  for (const item of content.items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5]);
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - y) > 2) {
      lines.push({ y, parts: [item.str] });
    } else {
      last.parts.push(item.str);
    }
  }
  return lines.map((line) => line.parts.join(" ")).join("\n");
}

function parseLabel(text, index) {
  const item = (text.match(/Item:\s*(\d+)/) || [])[1] || "";
  const blankMatch = text.match(/\bOL\d+/i);
  const sheetsMatch = text.match(/(\d[\d,]*)\s+Sheets/i);
  const beforeItem = text.split(/Item:/)[0] || "";
  const bins = [...beforeItem.matchAll(/\bY\d+\b/g)];
  return {
    index,
    item,
    sheets: sheetsMatch ? Number(sheetsMatch[1].replace(/,/g, "")) : 0,
    printBin: bins.length ? bins[bins.length - 1][0] : "",
    blank: blankMatch ? blankMatch[0].toUpperCase() : "",
  };
}

sheet.addEventListener("click", async () => {
  unmapped.innerHTML = "";
  const text = scheduleText();
  if (!text) return;
  const tab = window.open("", "_blank");
  if (!tab) {
    setStatus("Allow pop-ups for this site, then try again.", true);
    return;
  }
  sheet.disabled = true;
  try {
    ready ??= init();
    await ready;
    const result = JSON.parse(pull_sheet(text));
    const blob = new Blob([result.html], { type: "text/html" });
    tab.location = URL.createObjectURL(blob);
    setStatus(result.summary);
  } catch (err) {
    tab.close();
    setStatus(err && err.message ? err.message : String(err), true);
  } finally {
    sheet.disabled = false;
  }
});

go.addEventListener("click", async () => {
  unmapped.innerHTML = "";
  if (!pdfFile) takeFile(fileInput.files[0]);
  if (!pdfFile) {
    setStatus("Choose the package-label PDF.", true);
    return;
  }
  if (pdfFile.size > MAX_PDF_BYTES) {
    setStatus(pdfTooLargeMessage(pdfFile), true);
    return;
  }
  const text = scheduleText();
  if (!text) {
    setStatus("Step 1 first: paste the Sheeted Print Schedule above, then click Reorder & download.", true);
    schedule.focus();
    return;
  }
  go.disabled = true;
  setStatus("Reading labels…");
  try {
    ready ??= init();
    await ready;
    const bytes = new Uint8Array(await pdfFile.arrayBuffer());
    const loaded = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const labels = [];
    for (let i = 1; i <= loaded.numPages; i += 1) {
      if (i % 25 === 0 || i === loaded.numPages) setStatus("Reading labels… " + i + " of " + loaded.numPages);
      const page = await loaded.getPage(i);
      labels.push(parseLabel(pageText(await page.getTextContent()), i - 1));
      page.cleanup();
    }
    await loaded.destroy();
    setStatus("Matching the pull sheet…");
    const result = JSON.parse(plan_order(text, JSON.stringify(labels)));
    const order = result.order;
    if (!Array.isArray(order) || order.length !== labels.length) {
      throw new Error("The reorder did not return every page.");
    }
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, order);
    for (const page of pages) out.addPage(page);
    const blob = new Blob([await out.save()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = pdfFile.name.replace(/\.pdf$/i, "") + "_sheet-order.pdf";
    link.textContent = "Download " + link.download;
    link.className = "download";
    const missed = result.unmapped || [];
    const matched = labels.length - missed.length;
    setStatus(matched + " labels match the sheet. " + missed.length + " had no schedule row and are at the end.");
    status.append(document.createElement("br"), link);
    if (missed.length) {
      const list = document.createElement("ul");
      for (const label of missed) {
        const item = document.createElement("li");
        const name = label.item || "unknown item";
        const blank = label.blank ? " " + label.blank : "";
        item.textContent = "Page " + (label.index + 1) + ": " + name + blank;
        list.append(item);
      }
      unmapped.append(list);
    }
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), true);
  } finally {
    go.disabled = false;
  }
});

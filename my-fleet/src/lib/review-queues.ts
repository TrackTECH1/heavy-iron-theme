import { readFileSync, existsSync } from "fs";
import path from "path";
import type { ReviewWarning } from "./types";

const QUEUE_DIR = path.join(
  process.cwd(),
  "..",
  "data",
  "tracktech-source-of-truth-package",
  "03_review_queues",
);

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(filename: string): Record<string, string>[] {
  const filePath = path.join(QUEUE_DIR, filename);
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

export function getReviewQueueStats() {
  const files = [
    "track_size_review_queue.csv",
    "machine_missing_fields_review_queue.csv",
    "merge_conflicts_review_queue.csv",
    "product_review_queue.csv",
    "track_size_observations_crosswalk.csv",
  ];
  return files.map((file) => ({
    file,
    label: file.replace(/_/g, " ").replace(".csv", ""),
    count: readCsv(file).length,
  }));
}

export function getReviewQueueRows(
  queue: string,
  search?: string,
  limit = 100,
): Record<string, string>[] {
  const rows = readCsv(queue);
  if (!search) return rows.slice(0, limit);
  const q = search.toLowerCase();
  return rows
    .filter((row) =>
      Object.values(row).some((v) => v.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}

export function getMachineReviewWarnings(
  machine: { machine_id: string; brand: string; model: string; validation_status: string | null },
): ReviewWarning[] {
  const warnings: ReviewWarning[] = [];

  if (machine.validation_status && machine.validation_status !== "Verified") {
    warnings.push({
      queue: "validation_status",
      summary: `Machine validation: ${machine.validation_status}`,
    });
  }

  const missing = readCsv("machine_missing_fields_review_queue.csv").filter(
    (r) => r.machine_id === machine.machine_id,
  );
  for (const row of missing) {
    warnings.push({
      queue: "machine_missing_fields",
      summary: `Missing fields: ${row.missing_fields}`,
      detail: row.source_systems,
    });
  }

  const label = `${machine.brand} ${machine.model}`;
  const trackSize = readCsv("track_size_review_queue.csv").filter((r) =>
    (r.context ?? "").toLowerCase().includes(machine.model.toLowerCase()) ||
    (r.raw_track_size ?? "").toLowerCase().includes(label.toLowerCase()),
  );
  if (trackSize.length > 0) {
    warnings.push({
      queue: "track_size_review",
      summary: `${trackSize.length} track size review item(s) mention this model`,
      detail: trackSize[0].review_reason,
    });
  }

  const merge = readCsv("merge_conflicts_review_queue.csv").filter((r) =>
    (r.record_ids ?? "").includes(machine.machine_id),
  );
  for (const row of merge) {
    warnings.push({
      queue: "merge_conflicts",
      summary: `${row.conflict_type}: ${row.value}`,
      detail: row.action,
    });
  }

  return warnings;
}

export function getProductReviewWarnings(sku: string): ReviewWarning[] {
  return readCsv("product_review_queue.csv")
    .filter((r) => r.sku === sku)
    .map((row) => ({
      queue: "product_review",
      summary: row.issue,
      detail: row.action,
    }));
}

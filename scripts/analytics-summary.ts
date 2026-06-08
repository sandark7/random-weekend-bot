import Database from "better-sqlite3";
import { loadConfig } from "../src-node/config.js";

type AnalyticsRow = {
  event_name: string;
  user_id_hash: string | null;
  session_id: string;
  payload_json: string;
  created_at: string;
};

type ParsedRow = AnalyticsRow & {
  payload: Record<string, unknown>;
};

const config = loadConfig();
const db = new Database(config.DATABASE_PATH, { readonly: true });

try {
  printSummary("Last 24h", 24 * 60 * 60 * 1000);
  console.log("");
  printSummary("Last 7d", 7 * 24 * 60 * 60 * 1000);
} finally {
  db.close();
}

function printSummary(title: string, windowMs: number): void {
  const sinceIso = new Date(Date.now() - windowMs).toISOString();
  const rows = (db.prepare(`
    SELECT event_name, user_id_hash, session_id, payload_json, created_at
    FROM analytics_events
    WHERE created_at >= ?
    ORDER BY created_at ASC
  `).all(sinceIso) as AnalyticsRow[]).map(parseRow);

  const users = new Set(rows.map((row) => row.user_id_hash).filter(Boolean));
  const sessions = new Set(rows.map((row) => row.session_id).filter(Boolean));

  console.log(title);
  console.log(`- users: ${users.size}`);
  console.log(`- sessions: ${sessions.size}`);
  console.log(`- events: ${rows.length}`);
  console.log("");

  printCounts("Events", rows.map((row) => row.event_name));
  printCounts("Cities", rows.map(cityPayload).filter(isString));
  printCounts("Scenarios", rows.map((row) => stringPayload(row, "scenario")).filter(isString));
  printRouteSummary(rows);
  printCounts("Feedback", rows
    .filter((row) => row.event_name === "feedback_sent")
    .map((row) => stringPayload(row, "reason"))
    .filter(isString));
  printDistanceSummary(rows);
  printCounts("Top failure reasons", rows.map((row) => stringPayload(row, "failureReason")).filter(isString));
}

function parseRow(row: AnalyticsRow): ParsedRow {
  try {
    return { ...row, payload: JSON.parse(row.payload_json) as Record<string, unknown> };
  } catch {
    return { ...row, payload: {} };
  }
}

function isString(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function printCounts(title: string, values: string[]): void {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  console.log(title + ":");
  if (counts.size === 0) {
    console.log("- none");
    console.log("");
    return;
  }

  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .forEach(([value, count]) => console.log(`- ${value}: ${count}`));
  console.log("");
}

function printRouteSummary(rows: ParsedRow[]): void {
  const built = rows.filter((row) => row.event_name === "route_built").length;
  const failed = rows.filter((row) => row.event_name === "route_failed").length;
  const rebuilt = rows.filter((row) => row.event_name === "route_rebuilt").length;
  const rebuildFailed = rows.filter((row) => row.event_name === "route_rebuild_failed").length;
  const attempts = built + failed;
  const successRate = attempts > 0 ? Math.round((built / attempts) * 100) : 0;

  console.log("Routes:");
  console.log(`- built: ${built}`);
  console.log(`- failed: ${failed}`);
  console.log(`- success rate: ${successRate}%`);
  console.log(`- rebuilt: ${rebuilt}`);
  console.log(`- rebuild failed: ${rebuildFailed}`);
  console.log("");
}

function printDistanceSummary(rows: ParsedRow[]): void {
  const distances = rows
    .filter((row) => row.event_name === "place_suggested")
    .map((row) => numberPayload(row, "distanceMeters"))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  console.log("Distances:");
  if (distances.length === 0) {
    console.log("- median place distance: none");
    console.log("");
    return;
  }

  console.log(`- median place distance: ${percentile(distances, 0.5)} m`);
  console.log(`- p90 place distance: ${percentile(distances, 0.9)} m`);
  console.log("");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.floor((values.length - 1) * p));
  return values[index];
}

function stringPayload(row: ParsedRow, key: string): string | null {
  const value = row.payload[key];
  return typeof value === "string" ? value : null;
}

function cityPayload(row: ParsedRow): string | null {
  return (
    stringPayload(row, "citySlug") ??
    stringPayload(row, "locationCity") ??
    stringPayload(row, "routeCity") ??
    stringPayload(row, "placeCity")
  );
}

function numberPayload(row: ParsedRow, key: string): number | null {
  const value = row.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

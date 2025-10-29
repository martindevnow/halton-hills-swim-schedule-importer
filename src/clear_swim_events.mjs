// clear_swim_events.mjs
// Usage examples:
//   Dry-run (default):
//     node clear_swim_events.mjs --calendarId CAL_ID --start 2025-11-01 --end 2026-01-31
//   Actually delete (instances only):
//     node clear_swim_events.mjs --calendarId CAL_ID --start 2025-11-01 --end 2026-01-31 --confirm
//   Delete whole series when any instance is in range:
//     node clear_swim_events.mjs --calendarId CAL_ID --start 2025-11-01 --end 2026-01-31 --confirm --deleteSeries
//   Only target events created by your pool script (recommended):
//     node clear_swim_events.mjs --calendarId CAL_ID --start 2025-11-01 --end 2026-01-31 --confirm --privateKey source=pool-schedule
//
// Notes:
// - --start is inclusive at 00:00 local time; --end is exclusive at 00:00 the next day.
// - --privateKey filters by a single private extended property (key=value).
// - Requires credentials.json (OAuth desktop) beside this file; creates token.json on first run.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

// ---- CLI args (ESM) --------------------------------------------------------

const argv = yargs(hideBin(process.argv))
  .usage(
    "node $0 --calendarId <id> --start YYYY-MM-DD --end YYYY-MM-DD [options]"
  )
  .option("calendarId", {
    type: "string",
    demandOption: true,
    describe: "Target Google Calendar ID",
  })
  .option("start", {
    type: "string",
    demandOption: true,
    describe: "Start date (YYYY-MM-DD, inclusive)",
  })
  .option("end", {
    type: "string",
    demandOption: true,
    describe: "End date (YYYY-MM-DD, exclusive)",
  })
  .option("timezone", {
    type: "string",
    default: "America/Toronto",
    describe: "Timezone for the window",
  })
  .option("confirm", {
    type: "boolean",
    default: false,
    describe: "Actually delete (otherwise dry-run)",
  })
  .option("deleteSeries", {
    type: "boolean",
    default: false,
    describe:
      "Delete entire recurring series if any instance falls in the window",
  })
  .option("privateKey", {
    type: "string",
    describe:
      "Filter by private extended property: key=value (e.g., source=pool-schedule)",
  })
  .help()
  .parseSync();

// ---- Helpers ----------------------------------------------------------------

function readJSONSync(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSONSync(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function parsePrivateFilter(str) {
  if (!str) return null;
  const eq = str.indexOf("=");
  if (eq === -1) throw new Error("--privateKey must be key=value");
  const key = str.slice(0, eq).trim();
  const val = str.slice(eq + 1).trim();
  if (!key || !val) throw new Error("--privateKey must be key=value");
  return `${key}=${val}`;
}

// Convert YYYY-MM-DD as "local midnight" in a given IANA timezone to RFC3339 UTC.
// Works without extra deps by using Intl to get the local parts, then building a Date.
function isoLocalStart(dateStr, tz) {
  const d = new Date(`${dateStr}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt
    .formatToParts(d)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  // This Date is in local wall time, interpreted by host tz. Adjust to UTC string.
  const local = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  );
  return new Date(
    local.getTime() - local.getTimezoneOffset() * 60000
  ).toISOString();
}

// ---- Auth (ESM) -------------------------------------------------------------

async function authorize() {
  const credentials = readJSONSync(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  try {
    const token = readJSONSync(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } catch {
    return getNewToken(oAuth2Client);
  }
}

function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("\nAuthorize this app by visiting this URL:\n", authUrl, "\n");
  process.stdout.write("Paste the code here and press Enter: ");

  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", async (code) => {
      try {
        const { tokens } = await oAuth2Client.getToken(code.trim());
        oAuth2Client.setCredentials(tokens);
        writeJSONSync(TOKEN_PATH, tokens);
        console.log("Token saved to", TOKEN_PATH);
        resolve(oAuth2Client);
      } catch (err) {
        console.error("Error retrieving access token", err);
        process.exit(1);
      }
    });
  });
}

// ---- Calendar ops -----------------------------------------------------------

async function listEvents(calendar, opts) {
  const results = [];
  let pageToken;

  const params = {
    calendarId: opts.calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: true, // expand recurring instances
    maxResults: 2500,
    orderBy: "startTime",
  };
  if (opts.privateExtendedProperty)
    params.privateExtendedProperty = opts.privateExtendedProperty;

  do {
    const res = await calendar.events.list({ ...params, pageToken });
    const items = res.data.items || [];
    results.push(...items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return results;
}

async function deleteEvent(calendar, calendarId, eventId) {
  const maxRetries = 5;
  let attempt = 0;
  while (true) {
    try {
      await calendar.events.delete({ calendarId, eventId });
      return;
    } catch (e) {
      const status = e?.code || e?.response?.status;
      if (
        attempt < maxRetries &&
        [403, 429, 500, 502, 503, 504].includes(status)
      ) {
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      } else {
        throw e;
      }
    }
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const {
    calendarId,
    start,
    end,
    timezone,
    confirm,
    deleteSeries,
    privateKey,
  } = argv;

  const timeMin = isoLocalStart(start, timezone);
  const timeMax = isoLocalStart(end, timezone);
  const privateExtendedProperty = parsePrivateFilter(privateKey);

  const auth = await authorize();
  const calendar = google.calendar({ version: "v3", auth });

  console.log(`\nScanning events in ${calendarId}`);
  console.log(` Window: ${start} → ${end} (${timezone})`);
  console.log(
    ` Mode: ${confirm ? "DELETE" : "DRY-RUN"}; ${
      deleteSeries ? "delete whole series" : "delete instances only"
    }`
  );
  if (privateExtendedProperty)
    console.log(` Filter: privateExtendedProperty=${privateExtendedProperty}`);

  const events = await listEvents(calendar, {
    calendarId,
    timeMin,
    timeMax,
    privateExtendedProperty,
  });

  if (!events.length) {
    console.log("\nNo events found in the specified window.");
    return;
  }

  const instanceDeletes = [];
  const seriesIds = new Set();

  for (const ev of events) {
    const startStr = ev.start?.dateTime || ev.start?.date;
    const endStr = ev.end?.dateTime || ev.end?.date;
    const isRecurringInstance = !!ev.recurringEventId;

    console.log(
      `- ${ev.summary || "(no title)"}  [${startStr} → ${endStr}]  id=${ev.id}${
        isRecurringInstance ? `  recurringEventId=${ev.recurringEventId}` : ""
      }`
    );

    if (deleteSeries && ev.recurringEventId) {
      seriesIds.add(ev.recurringEventId);
    } else {
      instanceDeletes.push(ev.id);
    }
  }

  console.log(
    `\nPlanned deletions: ${instanceDeletes.length} instance(s)${
      deleteSeries ? `, ${seriesIds.size} series` : ""
    }`
  );

  if (!confirm) {
    console.log(
      "\nDry-run complete. Re-run with --confirm to perform deletions."
    );
    return;
  }

  for (const id of instanceDeletes) {
    try {
      await deleteEvent(calendar, calendarId, id);
      console.log(`Deleted instance: ${id}`);
    } catch (e) {
      console.error(`Failed to delete instance ${id}:`, e.message || e);
    }
  }

  for (const sid of seriesIds) {
    try {
      await deleteEvent(calendar, calendarId, sid);
      console.log(`Deleted series: ${sid}`);
    } catch (e) {
      console.error(`Failed to delete series ${sid}:`, e.message || e);
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

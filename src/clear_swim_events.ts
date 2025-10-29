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

import process from "node:process";
import { google } from "googleapis";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { isoLocalStart, parsePrivateFilter } from "./utils/helpers.js";
import { authorize } from "./utils/auth.js";
import { deleteEvent, listEvents } from "./utils/calendar.js";

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
  const seriesIds = new Set<string>();

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
    } catch (e: any) {
      console.error(`Failed to delete instance ${id}:`, e.message || e);
    }
  }

  for (const sid of seriesIds) {
    try {
      await deleteEvent(calendar, calendarId, sid);
      console.log(`Deleted series: ${sid}`);
    } catch (e: any) {
      console.error(`Failed to delete series ${sid}:`, e.message || e);
    }
  }

  console.log("\nDone.");
}

main()
  .then(() => {
    console.log("Main complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

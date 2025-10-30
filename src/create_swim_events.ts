// create_swim_events.ts
// Usage:
//   node create_swim_events.mjs --config config.json --schedule schedule.csv [--confirm]
//
// Deps: npm i googleapis csv-parse
// Notes:
// - --confirm: OAuth/auth calls, and event creation. *Omitting this would just prints what would be created.*
// - Creates weekly recurring events (BYDAY) from CSV rows between Start..End.
// - Location & color pulled from config.places[Place] (fallbacks supported).
// - Tags with extendedProperties.private.source = "pool-schedule" for cleanups.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { readJSONSync } from "./utils/helpers.js";
import { expandRowsToRules, parseScheduleCSV } from "./utils/csv.js";
import { authorize } from "./utils/auth.js";
import { createRecurringEvent } from "./utils/calendar.js";

type CliArgs = {
  config: string;
  schedule: string;
  confirm: boolean;
};

const argv = yargs(hideBin(process.argv))
  .usage("node $0 --config <config.json> --schedule <schedule.csv> [--confirm]")
  .option("config", {
    alias: "c",
    type: "string",
    describe: "Path to configuration JSON file",
    demandOption: true,
  })
  .option("schedule", {
    alias: "s",
    type: "string",
    describe: "Path to swim schedule CSV file",
    demandOption: true,
  })
  .option("confirm", {
    type: "boolean",
    default: false,
    describe: "Actually create events (otherwise dry-run)",
  })
  .strict()
  .help()
  .parseSync() as CliArgs;

// ---------- main ----------
async function main() {
  const cfgPath = argv.config;
  const csvPath = argv.schedule;
  const dryRun = !argv.confirm;

  if (!cfgPath || !csvPath) {
    console.error(
      "Usage: node create_swim_events.mjs --config <config.json> --schedule <schedule.csv> [--confirm]"
    );
    process.exit(1);
  }

  const cfg = readJSONSync(path.resolve(cfgPath));
  if (!cfg.calendarId) {
    console.error("Missing calendarId in config.");
    process.exit(1);
  }
  if (!cfg.timezone) {
    console.error("Missing timezone in config.");
    process.exit(1);
  }

  const csvText = fs.readFileSync(path.resolve(csvPath), "utf8");
  const parsed = parseScheduleCSV(csvText);
  const rules = expandRowsToRules(parsed.rows, parsed.season);

  let calendar = null;
  if (!dryRun) {
    const auth = await authorize();
    calendar = google.calendar({ version: "v3", auth });
  } else {
    console.log(
      "DRY-RUN MODE: No OAuth, no events will be created. Preview only.\n"
    );
  }

  for (const rule of rules) {
    const place = rule._place;
    for (const byDay of rule.byDay) {
      await createRecurringEvent(calendar, cfg, rule, byDay, place, dryRun);
    }
  }

  console.log(
    dryRun ? "\nDry-run complete." : "\nAll events created from CSV."
  );
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

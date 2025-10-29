import { parse } from "csv-parse/sync";
import { BYDAY, pad2, parseDateLoose, type ByDayFull } from "./helpers.js";
import { parseTimeRange } from "./time.js";

// ---------- CSV ingestion ----------
export const parseScheduleCSV = (csvText: string) => {
  const records = parse(csvText, { relax_quotes: true, trim: true });
  if (!records || !records.length) throw new Error("Empty CSV");

  let seasonStart = null,
    seasonEnd = null;
  let headerIndex = -1;

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!.map((x) => (x ?? "").toString().trim());
    if (/^start$/i.test(row[0] || "") && row[1]) {
      const { y, m, d } = parseDateLoose(row[1].replace(/^"|"$/g, ""));
      seasonStart = `${y}-${pad2(m)}-${pad2(d)}`;
    } else if (/^end$/i.test(row[0] || "") && row[1]) {
      const { y, m, d } = parseDateLoose(row[1].replace(/^"|"$/g, ""));
      seasonEnd = `${y}-${pad2(m)}-${pad2(d)}`;
    } else if (
      /^place$/i.test(row[0] || "") &&
      /^day$/i.test(row[1] || "") &&
      /^time$/i.test(row[2] || "")
    ) {
      headerIndex = i;
      break;
    }
  }
  if (!seasonStart || !seasonEnd)
    throw new Error("CSV must include Start and End rows.");
  if (headerIndex === -1)
    throw new Error('CSV must include a header row: "Place,Day,Time,Swim".');

  const rows = [];
  let lastPlace = "";
  let lastDay = "";
  for (let i = headerIndex + 1; i < records.length; i++) {
    const [placeRaw, dayRaw, timeRaw, swimRaw] = records[i]!.map((x) =>
      (x ?? "").toString().trim()
    );
    if (!placeRaw && !dayRaw && !timeRaw && !swimRaw) continue;

    if (placeRaw) lastPlace = placeRaw;
    if (dayRaw) lastDay = dayRaw;

    const place = lastPlace;
    const day: ByDayFull = lastDay as ByDayFull;
    const timeStr = timeRaw;
    const swim = swimRaw || "";

    if (!place || !day || !timeStr) continue;

    const byDay = BYDAY[day];
    if (!byDay) throw new Error(`Unrecognized day "${day}" at row ${i + 1}`);

    rows.push({ place, day, byDay, timeRange: timeStr, swim });
  }

  return { season: { startDate: seasonStart, endDate: seasonEnd }, rows };
};

type Season = {
  startDate: string;
  endDate: string;
};

export const expandRowsToRules = (rows: Array<any>, season: Season) => {
  return rows.map((r) => {
    const { start, end } = parseTimeRange(r.timeRange);
    return {
      summary: r.swim ? `${r.swim} Swim` : "Swim",
      description: r.swim || "",
      startTime: `${pad2(start.hour)}:${pad2(start.minute)}`,
      endTime: `${pad2(end.hour)}:${pad2(end.minute)}`,
      byDay: [r.byDay],
      season: { startDate: season.startDate, endDate: season.endDate },
      _place: r.place,
    };
  });
};

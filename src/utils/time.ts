// ---------- time parsing ----------
export const parseTimeRange = (rangeStr: string) => {
  const s = rangeStr.trim().toLowerCase();
  const m = s.match(
    /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i
  );
  if (!m) throw new Error(`Unrecognized time range: "${rangeStr}"`);
  let [, h1, m1, h2, m2, suf] = m;
  let hh1 = parseInt(h1 as string, 10),
    mm1 = m1 ? parseInt(m1, 10) : 0;
  let hh2 = parseInt(h2 as string, 10),
    mm2 = m2 ? parseInt(m2, 10) : 0;

  if (suf) {
    const end12 = hh2 === 12;
    if (suf === "am") {
      hh1 = hh1 === 12 ? 0 : hh1;
      hh2 = hh2 === 12 ? 0 : hh2;
    } else if (suf === "pm") {
      if (end12) {
        // Treat "11-12pm" as 11:00–12:00 (start AM, end 12pm)
      } else {
        if (hh1 !== 12) hh1 += 12;
      }
      if (hh2 !== 12) hh2 += 12;
    }
  }
  return { start: { hour: hh1, minute: mm1 }, end: { hour: hh2, minute: mm2 } };
};

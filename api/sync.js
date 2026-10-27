// 매일 새벽 나이스(NEIS)에서 학사일정·급식·반별 시간표를 받아 Supabase에 반영해요.
// Vercel Cron이 호출해요 (Claude 사용량 없음). part=school | tt
const SU = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY, K = process.env.NEIS_KEY || "";
const H = { apikey: SR, Authorization: "Bearer " + SR, "content-type": "application/json" };
const NB = "https://open.neis.go.kr/hub/";
const base = "Type=json&ATPT_OFCDC_SC_CODE=I10&SD_SCHUL_CODE=9300191&pIndex=1&pSize=" + (K ? 1000 : 5) + (K ? "&KEY=" + K : "");
const sl = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
const kst = () => new Date(Date.now() + 9 * 3600e3);
const addD = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6))); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6)) - Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6))) / 864e5);
const dash = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;

async function get(svc, q) {
  for (let t = 0; t < 3; t++) {
    try { const j = await (await fetch(NB + svc + "?" + base + "&" + q)).json(); const h = j[svc]; if (!h) return { tot: 0, rows: [] }; return { tot: h[0].head[0].list_total_count, rows: h[1].row }; }
    catch (e) { await sl(400); }
  }
  return { tot: 0, rows: [] };
}
async function range(svc, fk, tk, f, t) {
  const r = await get(svc, `${fk}=${f}&${tk}=${t}`);
  if (K || r.tot <= 5 || f === t) return r.rows;
  const m = addD(f, Math.floor(diff(f, t) / 2));
  const [a, b] = await Promise.all([range(svc, fk, tk, f, m), range(svc, fk, tk, addD(m, 1), t)]);
  return [...a, ...b];
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const r = await fetch(SU + "/rest/v1/docs?on_conflict=path", { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
    if (!r.ok) throw new Error("upsert " + r.status + " " + (await r.text()).slice(0, 200));
  }
}
const row = (coll, id, data) => ({ path: coll + "/" + id, coll, doc_id: id, owner: null, data, updated_at: new Date().toISOString() });

function evType(n) {
  if (/회고사|연합평가|모의고사|수학능력/.test(n)) return "지필고사";
  if (/체육대회|체험학습|수학여행|교육발표회|축제/.test(n)) return "행사";
  return "학사일정";
}

async function school() {
  const today = ymd(kst()), from = addD(today, -7), to = addD(today, 150);
  const S = (await range("SchoolSchedule", "AA_FROM_YMD", "AA_TO_YMD", from, to)).filter(r => r.EVENT_NM !== "토요휴업일")
    .sort((a, b) => a.AA_YMD.localeCompare(b.AA_YMD));
  // 방학처럼 매일 이어지는 행은 첫날 하나로 합치기
  const kept = []; const runs = {};
  for (const r of S) {
    if (/^(여름|겨울)방학$/.test(r.EVENT_NM)) {
      const k = r.EVENT_NM; const run = runs[k];
      if (run && diff(run.last, r.AA_YMD) <= 3) { run.last = r.AA_YMD; continue; }
      runs[k] = { row: r, last: r.AA_YMD }; kept.push(r); continue;
    }
    kept.push(r);
  }
  const cnt = {}, now = Date.now(), rows = [];
  for (const r of kept) {
    const d = r.AA_YMD; cnt[d] = (cnt[d] || 0) + 1; const id = "neis-" + d + (cnt[d] > 1 ? "-" + cnt[d] : "");
    const gr = (r.ONE_GRADE_EVENT_YN === "Y" ? "1" : "") + (r.TW_GRADE_EVENT_YN === "Y" ? "2" : "") + (r.THREE_GRADE_EVENT_YN === "Y" ? "3" : "");
    let title = r.EVENT_NM;
    const run = runs[r.EVENT_NM]; if (run && run.row === r && run.last !== d) { const l = run.last; title = `${r.EVENT_NM} (~${+l.slice(4, 6)}월 ${+l.slice(6)}일)`; }
    const data = { date: dash(d), title, period: 0, type: evType(r.EVENT_NM), classes: "", subject: "", memo: r.SBTR_DD_SC_NM === "해당없음" ? "" : r.SBTR_DD_SC_NM, files: [], createdAt: now, updatedAt: now, source: "neis" };
    if (gr === "123" || !gr) data.grade = "all"; else if (gr.length === 1) data.grade = gr; else { data.grade = "multi"; data.grades = gr.split(""); }
    rows.push(row("events", id, data));
  }
  await upsert(rows);
  // 기간 안에서 나이스에서 사라진 일정 지우기
  const keep = new Set(rows.map(r => r.doc_id));
  const ex = await (await fetch(`${SU}/rest/v1/docs?coll=eq.events&doc_id=like.neis-*&select=doc_id`, { headers: H })).json();
  const stale = (Array.isArray(ex) ? ex : []).map(x => x.doc_id).filter(id => { const d = id.slice(5, 13); return d >= from && d <= to && !keep.has(id); });
  for (const id of stale) await fetch(`${SU}/rest/v1/docs?path=eq.events/${id}`, { method: "DELETE", headers: H });

  const M = await range("mealServiceDietInfo", "MLSV_FROM_YMD", "MLSV_TO_YMD", addD(today, -3), addD(today, 20));
  const md = {};
  for (const r of M) {
    const k = r.MMEAL_SC_NM === "중식" ? "lunch" : r.MMEAL_SC_NM === "석식" ? "dinner" : null; if (!k) continue;
    const d = dash(r.MLSV_YMD); md[d] = md[d] || { date: d, lunch: null, dinner: null, source: "neis" };
    md[d][k] = { kcal: parseFloat(r.CAL_INFO) || 0, menu: r.DDISH_NM.split(/<br\/?>/).map(s => s.trim().replace(/ \(([0-9.]+)\)/g, "($1)")).filter(Boolean) };
  }
  await upsert(Object.values(md).map(m => row("meals", m.date, { ...m, updatedAt: Date.now() })));
  return { events: rows.length, removed: stale.length, meals: Object.keys(md).length };
}

async function timetable() {
  const today = ymd(kst()), dw = kst().getUTCDay();
  const mon = addD(today, dw === 0 ? 1 : dw === 6 ? 2 : 1 - dw), days = [0, 1, 2, 3, 4].map(i => addD(mon, i));
  const cls = []; for (let g = 1; g <= 3; g++) for (let c = 1; c <= 15; c++) cls.push([g, c]);
  const probe = await pool(cls, 10, async ([g, c]) => (await get("hisTimetable", `ALL_TI_YMD=${days[1]}&GRADE=${g}&CLASS_NM=${c}`)).rows.length || (await get("hisTimetable", `ALL_TI_YMD=${days[0]}&GRADE=${g}&CLASS_NM=${c}`)).rows.length);
  const live = cls.filter((_, i) => probe[i]);
  const jobs = []; live.forEach(([g, c]) => days.forEach(d => jobs.push([g, c, d])));
  const res = await pool(jobs, 10, async ([g, c, d]) => get("hisTimetable", `ALL_TI_YMD=${d}&GRADE=${g}&CLASS_NM=${c}`));
  const docs = {};
  jobs.forEach(([g, c, d], i) => {
    const r = res[i]; const id = g + "-" + c; docs[id] = docs[id] || { cls: id, week: dash(mon), days: {}, partial: !K, source: "neis" };
    if (r.rows.length) docs[id].days[dash(d)] = { n: r.tot, p: r.rows.sort((a, b) => a.PERIO - b.PERIO).map(x => x.ITRT_CNTNT.replace(/\s+/g, " ").trim()) };
  });
  await upsert(Object.values(docs).map(d => row("timetable", d.cls, { ...d, updatedAt: Date.now() })));
  return { classes: Object.keys(docs).length, week: dash(mon) };
}

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  const sec = process.env.CRON_SECRET;
  const u = new URL(req.url, "http://x");
  if (sec && req.headers.authorization !== "Bearer " + sec && u.searchParams.get("key") !== sec) { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
  if (!SU || !SR) { res.statusCode = 500; return res.end('{"error":"server not configured"}'); }
  try {
    const part = u.searchParams.get("part") || "school";
    const out = part === "tt" ? await timetable() : await school();
    res.end(JSON.stringify({ ok: true, part, ...out }));
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e).slice(0, 300) })); }
};

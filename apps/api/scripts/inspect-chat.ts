import "dotenv/config";
import { getPool } from "../src/lib/pg-client.js";

const pool = getPool();
const cols = async (t: string) =>
  (await pool.query(`select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows
    .map((r) => `${r.column_name}:${r.data_type}${r.column_default ? "=" + String(r.column_default).slice(0, 30) : ""}`)
    .join(", ");
console.log("lead_messages ->", await cols("lead_messages"));
const { rows: tabs } = await pool.query(
  `select table_name from information_schema.tables where table_schema='public' and (table_name ilike '%review%' or table_name ilike '%rating%' or table_name ilike '%feedback%' or table_name ilike '%presence%' or table_name ilike '%upload%' or table_name ilike '%media%' or table_name ilike '%bank%' or table_name ilike '%payout%')`,
);
for (const t of tabs) console.log(t.table_name, "->", await cols(t.table_name));
console.log("vendors rating cols ->", (await cols("vendors")).split(", ").filter((c) => /rating|review|upi|bank|ifsc|account/i.test(c)).join(", "));
console.log("leads ->", await cols("leads"));
console.log("lead_notifications ->", await cols("lead_notifications"));
const { rows: st } = await pool.query(`select status, count(*)::int from public.leads group by 1`);
console.log("lead statuses", st);
const { rows: ms } = await pool.query(`select count(*)::int n, count(image_url)::int img from public.lead_messages`);
console.log("messages", ms);
await pool.end();

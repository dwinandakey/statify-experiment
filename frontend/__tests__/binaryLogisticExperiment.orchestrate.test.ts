/**
 * Orkestrator sesi v2 (tests/experiment/orchestrate.mjs), fungsi murninya:
 * - salinan mulberry32/deriveSeed/shuffleInPlace dan urutan workload identik dengan services/prng.ts;
 * - jadwal selang-seling pilot-chrome, pilot-firefox, chrome-01, firefox-01, … dengan
 *   orderSeed = orderSeedBase + indeks global;
 * - deteksi sesi lengkap untuk resume; jumlah run per batch.
 * Skrip berupa ES module, jadi dijalankan di proses Node terpisah.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deriveSeed, mulberry32, shuffledWorkloads } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/prng";

const repo = path.join(__dirname, "../..");
const script = path.join(repo, "tests/experiment/orchestrate.mjs");

function withModule<T>(body: string): T {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(script).href)});\n${body}`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module"], { input: code, encoding: "utf8" })) as T;
}

test("PRNG dan urutan workload identik dengan services/prng.ts", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => 1000 + i);
  const fromScript = withModule<{ orders: string[][]; draws: number[]; derived: number[] }>(`
    const seeds = ${JSON.stringify(seeds)};
    const r = m.mulberry32(m.deriveSeed(7, -2));
    console.log(JSON.stringify({
      orders: seeds.map((s) => m.workloadOrder(["full", "core"], s)),
      draws: Array.from({ length: 20 }, () => r()),
      derived: seeds.map((s) => m.deriveSeed(s, -1)),
    }));
  `);
  expect(fromScript.orders).toEqual(seeds.map((s) => shuffledWorkloads(["core", "full"], s)));
  const r = mulberry32(deriveSeed(7, -2));
  expect(fromScript.draws).toEqual(Array.from({ length: 20 }, () => r()));
  expect(fromScript.derived).toEqual(seeds.map((s) => deriveSeed(s, -1)));
});

test("jadwal bench.v2.json: 1 pilot + 10 sesi per browser, selang-seling, orderSeed per indeks global", () => {
  const schedule = withModule<{ id: string; index: number; role: string; browser: string; orderSeed: number; workloads: string[]; dir: string }[]>(`
    const cfg = m.loadConfig(${JSON.stringify(path.join(repo, "tests/experiment/bench.v2.json"))});
    console.log(JSON.stringify(m.buildSchedule(cfg)));
  `);
  expect(schedule).toHaveLength(22);
  expect(schedule.slice(0, 5).map((s) => s.id)).toEqual(["pilot-chrome", "pilot-firefox", "chrome-01", "firefox-01", "chrome-02"]);
  expect(schedule.at(-1)!.id).toBe("firefox-10");
  schedule.forEach((s, i) => {
    expect(s.index).toBe(i);
    expect(s.orderSeed).toBe(1000 + i);
    expect([...s.workloads].sort()).toEqual(["core", "full"]);
    expect(s.workloads).toEqual(shuffledWorkloads(["core", "full"], s.orderSeed));
  });
  expect(schedule[0]).toMatchObject({ role: "pilot", browser: "chrome", dir: "chrome/pilot-01" });
  expect(schedule[3]).toMatchObject({ role: "measure", browser: "firefox", dir: "firefox/measure-01" });
});

test("runsPerBatch: 4 N × (5 + 30) × 6 sel = 840; dry run 2 × 3 × 6 = 36", () => {
  const runs = withModule<number[]>(`
    console.log(JSON.stringify(["bench.v2.json", "bench.v2.mini.json"].map((f) =>
      m.runsPerBatch(m.loadConfig(${JSON.stringify(path.join(repo, "tests/experiment"))} + "/" + f)))));
  `);
  expect(runs).toEqual([840, 36]);
});

test("sesi lengkap untuk resume: status done dan berkas setiap workload ada", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrate-"));
  try {
    const session = {
      status: "done",
      workloadOrder: ["full", "core"],
      batches: [
        { workload: "full", status: "done", csv: "f.csv", meta: "f-meta.json" },
        { workload: "core", status: "done", csv: "c.csv", meta: "c-meta.json" },
      ],
    };
    fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(session));
    for (const f of ["f.csv", "f-meta.json", "c.csv"]) fs.writeFileSync(path.join(dir, f), "x");
    const check = () => withModule<boolean>(`console.log(JSON.stringify(m.sessionComplete(${JSON.stringify(dir)})));`);
    expect(check()).toBe(false); // c-meta.json belum ada
    fs.writeFileSync(path.join(dir, "c-meta.json"), "x");
    expect(check()).toBe(true);
    fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ ...session, status: "error" }));
    expect(check()).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

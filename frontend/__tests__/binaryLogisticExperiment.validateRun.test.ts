/**
 * Validator run v2 (scripts/validateRun.mjs), fungsi murninya dengan data sintetis:
 * jumlah run per (N, sel), error, pageHidden, clockCheckFailed, konvergensi, iterasi sama,
 * tabel SPSS (workload full), selisih koefisien, dan parser CSV ber-kutip.
 * Skrip berupa ES module, jadi dijalankan di proses Node terpisah.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const script = path.join(__dirname, "../scripts/validateRun.mjs");

function withModule<T>(body: string): T {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(script).href)});\n${body}`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module"], { input: code, encoding: "utf8" })) as T;
}

type Row = Record<string, string>;
const CELLS = ["A", "B-warm", "B-cold", "C", "D-warm", "D-cold"];
const row = (N: number, cell: string, rep: number, extra: Row = {}): Row => ({
  N: String(N),
  cell,
  rep: String(rep),
  error: "",
  pageHidden: "false",
  clockCheckFailed: cell === "A" || cell === "C" ? "" : "false",
  converged: "true",
  iterations: "7",
  tablesIdenticalToD: "true",
  B_Constant: "-4.4",
  SE_Constant: "0.07",
  ...extra,
});
const batch = (reps = 2): Row[] => [1000, 10000].flatMap((N) => CELLS.flatMap((c) => Array.from({ length: reps }, (_, k) => row(N, c, k + 1))));
const expected = { repetitions: 2, sizes: [1000, 10000], cells: CELLS };

const check = (rows: Row[], workload = "core") =>
  withModule<string[]>(`console.log(JSON.stringify(m.checkBatchRows(${JSON.stringify(rows)}, ${JSON.stringify(workload)}, ${JSON.stringify(expected)})));`);

test("batch lengkap dan bersih → tanpa pelanggaran", () => {
  expect(check(batch())).toEqual([]);
  expect(check(batch(), "full")).toEqual([]);
});

test("run kurang, error, pageHidden, clockCheckFailed, tidak konvergen, iterasi berbeda, tabel SPSS berbeda", () => {
  const rows = batch();
  rows.pop(); // N=10000 D-cold tinggal 1 run
  rows[0] = row(1000, "A", 1, { error: "boom" });
  rows[1] = row(1000, "A", 2, { pageHidden: "true" });
  rows[2] = row(1000, "B-warm", 1, { clockCheckFailed: "true" });
  rows[3] = row(1000, "B-warm", 2, { converged: "false", iterations: "20" });
  rows[4] = row(1000, "B-cold", 1, { tablesIdenticalToD: "false" });
  const v = check(rows, "full");
  expect(v).toEqual(
    expect.arrayContaining([
      "full: N=10000 cell=D-cold has 1 runs, expected 2",
      expect.stringMatching(/^full: error at N=1000 cell=A rep=1: boom/),
      "full: pageHidden=true at N=1000 cell=A rep=2",
      "full: clockCheckFailed at N=1000 cell=B-warm rep=1",
      "full: not converged at N=1000 cell=B-warm rep=2",
      "full: SPSS tables differ from D-warm at N=1000 cell=B-cold rep=1",
      "full: N=1000 iterations differ between runs/cells: 7, 20",
    ])
  );
  // workload core tidak memeriksa tabel SPSS
  expect(check(rows, "core").some((s) => s.includes("SPSS"))).toBe(false);
});

test("selisih koefisien maksimum terhadap baris acuan; NaN terbawa sebagai selisih", () => {
  const ref = row(1000, "D-warm", 1);
  const d = withModule<{ beta: number; se: number }>(
    `console.log(JSON.stringify(m.maxCoefDiff(${JSON.stringify([ref, { ...ref, B_Constant: "-4.4000000001" }, { ...ref, SE_Constant: "0.0700000002" }])}, ${JSON.stringify(ref)})));`
  );
  expect(d.beta).toBeCloseTo(1e-10, 15);
  expect(d.se).toBeCloseTo(2e-10, 15);
  const withNaN = withModule<{ beta: number | null }>(
    `const r = m.maxCoefDiff([{ ...${JSON.stringify(ref)}, B_Constant: "x" }], ${JSON.stringify(ref)}); console.log(JSON.stringify({ beta: Number.isNaN(r.beta) ? null : r.beta }));`
  );
  expect(withNaN.beta).toBeNull();
});

test("parser CSV: field ber-kutip berisi koma dan kutip ganda", () => {
  const rows = withModule<Row[]>(
    `console.log(JSON.stringify(m.parseCsv('a,userAgent,b\\r\\n1,"Mozilla/5.0 (KHTML, like Gecko) ""x""",2\\r\\n')));`
  );
  expect(rows).toEqual([{ a: "1", userAgent: 'Mozilla/5.0 (KHTML, like Gecko) "x"', b: "2" }]);
});

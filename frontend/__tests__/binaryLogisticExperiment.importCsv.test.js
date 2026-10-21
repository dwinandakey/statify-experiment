/**
 * Impor dataset benchmark v2 (experiment-data/brfss_bench_100k.csv) lewat worker CSV produksi
 * (public/workers/DataManagement/csvWorker.js). Kolom STRING (GenHlth) dengan ≳ 65 rb baris dulu
 * gagal di Web Worker browser ("Maximum call stack size exceeded") karena lebar kolom dihitung
 * dengan spread argumen Math.max(...nilai). Worker dijalankan di thread Node dengan stack kecil
 * (seperti Web Worker browser) supaya kegagalan itu tereproduksi bila muncul lagi.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const frontend = path.join(__dirname, "..");
const csvWorker = path.join(frontend, "public/workers/DataManagement/csvWorker.js");
const dataset = path.join(frontend, "../experiment-data/brfss_bench_100k.csv");

/** Jalankan csvWorker.js di worker_threads (stack 0,5 MB; Web Worker Chrome gagal mulai ±80 rb argumen) dan kembalikan pesan pertama yang dikirimnya. */
function runCsvWorker(fileContent) {
  const bootstrap = `
    const { parentPort, workerData } = require("node:worker_threads");
    const self = { postMessage: (m) => parentPort.postMessage(m) };
    new Function("self", require("node:fs").readFileSync(workerData.script, "utf8"))(self);
    self.onmessage({ data: { fileContent: workerData.fileContent, options: workerData.options } });
  `;
  return new Promise((resolve, reject) => {
    const w = new Worker(bootstrap, {
      eval: true,
      resourceLimits: { stackSizeMb: 0.5 },
      workerData: {
        script: csvWorker,
        fileContent,
        options: { firstLineContains: true, removeLeading: false, removeTrailing: false, delimiter: "comma", decimal: "period", textQualifier: "doubleQuote" },
      },
    });
    w.once("message", (m) => {
      resolve(m);
      w.terminate();
    });
    w.once("error", reject);
  });
}

test("brfss_bench_100k.csv: 100.000 baris, GenHlth STRING/nominal, kolom lain NUMERIC/scale", async () => {
  const msg = await runCsvWorker(fs.readFileSync(dataset, "utf8"));
  expect(msg.error).toBeUndefined();
  const { variables, data } = msg.result;
  expect(data).toHaveLength(100_000);
  expect(variables.map((v) => `${v.name}:${v.type}/${v.measure}`)).toEqual([
    "Diabetes_binary:NUMERIC/scale",
    "HighBP:NUMERIC/scale",
    "HighChol:NUMERIC/scale",
    "BMI:NUMERIC/scale",
    "PhysActivity:NUMERIC/scale",
    "Sex:NUMERIC/scale",
    "Age:NUMERIC/scale",
    "Income:NUMERIC/scale",
    "GenHlth:STRING/nominal",
  ]);
  // Lebar kolom STRING = panjang nilai terpanjang ("2_very_good" = 11), minimal 8
  expect(variables[8].width).toBe(11);
});

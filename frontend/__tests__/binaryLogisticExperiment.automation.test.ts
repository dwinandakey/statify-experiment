/**
 * Hook otomasi window.__blExp (eksperimen v2): hanya terpasang bila URL berisi
 * expAutomation=1; output batch disimpan dan bisa dikosongkan; exportDesign memakai
 * penyedia dialog yang sedang terbuka.
 */
import type { DesignExport } from "@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/automation";

type Hook = {
  getBatchOutputs(): { batchId: string }[];
  clearBatchOutputs(): void;
  waitForBatchOutputs(count: number): Promise<number>;
  exportDesign(N: number): Promise<DesignExport>;
};
const hook = () => (window as unknown as { __blExp?: Hook }).__blExp;

async function freshModule() {
  jest.resetModules();
  return import("@/components/Modals/Analyze/Regression/BinaryLogisticExperiment/services/automation");
}

const output = (batchId: string) => ({ batchId, workload: "core" as const, status: "done", csv: "a,b\r\n", metaJson: "{}" });

afterEach(() => {
  delete (window as unknown as { __blExp?: Hook }).__blExp;
  window.history.pushState({}, "", "/");
});

test("tanpa expAutomation=1: tidak ada window.__blExp dan output tidak disimpan", async () => {
  window.history.pushState({}, "", "/dashboard/data?expSession=chrome-01");
  const m = await freshModule();
  const release = m.installAutomationHook(async () => ({}) as DesignExport);
  m.recordBatchOutput(output("b1"));
  expect(hook()).toBeUndefined();
  release();
});

test("dengan expAutomation=1: getBatchOutputs, clearBatchOutputs, exportDesign", async () => {
  window.history.pushState({}, "", "/dashboard/data?expAutomation=1&expSession=chrome-01");
  const m = await freshModule();
  const design = { n: 3 } as DesignExport;
  const release = m.installAutomationHook(async (N) => ({ ...design, n: N }));
  m.recordBatchOutput(output("b1"));
  m.recordBatchOutput(output("b2"));
  expect(hook()!.getBatchOutputs().map((o) => o.batchId)).toEqual(["b1", "b2"]);
  await expect(hook()!.exportDesign(1000)).resolves.toMatchObject({ n: 1000 });
  hook()!.clearBatchOutputs();
  expect(hook()!.getBatchOutputs()).toEqual([]);
  // Dialog ditutup: output tetap bisa dibaca, exportDesign menolak dengan pesan jelas
  m.recordBatchOutput(output("b3"));
  release();
  expect(hook()!.getBatchOutputs().map((o) => o.batchId)).toEqual(["b3"]);
  await expect(hook()!.exportDesign(10)).rejects.toThrow(/Open the Binary Logistic \(Experiment\) dialog/);
});

test("waitForBatchOutputs selesai saat output ke-n tercatat (tanpa polling)", async () => {
  window.history.pushState({}, "", "/dashboard/data?expAutomation=1");
  const m = await freshModule();
  const release = m.installAutomationHook(async () => ({}) as DesignExport);
  m.recordBatchOutput(output("b1"));
  await expect(hook()!.waitForBatchOutputs(1)).resolves.toBe(1);
  let settled = 0;
  const second = hook()!.waitForBatchOutputs(2).then((n) => (settled = n));
  const third = hook()!.waitForBatchOutputs(3).then((n) => n);
  await Promise.resolve();
  expect(settled).toBe(0);
  m.recordBatchOutput(output("b2"));
  await second;
  expect(settled).toBe(2);
  m.recordBatchOutput(output("b3"));
  await expect(third).resolves.toBe(3);
  release();
});

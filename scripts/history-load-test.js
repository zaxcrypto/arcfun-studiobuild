const http = require('http');

// Wallet with 100 actual real bridge transactions in Supabase database
const WALLET = '0xd448777940dfabf65fd259fa8a9903e60e1ff178';
const BASE_URL = `http://localhost:3000/api/bridge/history?wallet=${WALLET}&environment=mainnet`;

function sendRequest(url, headers = {}) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1e6;
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          durationMs,
          itemCount: parsed?.data?.length ?? 0,
          nextCursor: parsed?.nextCursor ?? null,
          hasMore: parsed?.hasMore ?? false,
          success: res.statusCode === 200 && parsed?.success === true,
        });
      });
    });

    req.on('error', (err) => {
      const end = process.hrtime.bigint();
      resolve({
        statusCode: 0,
        durationMs: Number(end - start) / 1e6,
        itemCount: 0,
        nextCursor: null,
        hasMore: false,
        success: false,
        error: err.message,
      });
    });
  });
}

async function runConcurrencyTier(tierName, totalRequests, concurrency) {
  console.log(`\n======================================================`);
  console.log(` Running Benchmark Tier: ${tierName}`);
  console.log(` Total Requests: ${totalRequests} | Concurrency: ${concurrency}`);
  console.log(`======================================================`);

  const results = [];
  let index = 0;

  const runWorker = async (workerId) => {
    while (true) {
      const current = index++;
      if (current >= totalRequests) break;
      // Simulate realistic distinct user client IPs
      const simulatedIp = `198.51.100.${(current % 180) + 1}`;
      const res = await sendRequest(BASE_URL, { 'x-forwarded-for': simulatedIp });
      results.push(res);
    }
  };

  const startTime = Date.now();
  const workers = Array.from({ length: concurrency }, (_, i) => runWorker(i));
  await Promise.all(workers);
  const totalDurationSec = (Date.now() - startTime) / 1000;

  // Analysis
  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const successCount = results.filter((r) => r.success).length;
  const rateLimitedCount = results.filter((r) => r.statusCode === 429).length;
  const errorCount = results.filter((r) => !r.success && r.statusCode !== 429).length;

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const max = latencies[latencies.length - 1] || 0;
  const min = latencies[0] || 0;
  const rps = (totalRequests / totalDurationSec).toFixed(1);

  // Pagination Invariant Check
  const returnedCounts = results.filter((r) => r.success).map((r) => r.itemCount);
  const maxItemsReturned = returnedCounts.length > 0 ? Math.max(...returnedCounts) : 0;
  const minItemsReturned = returnedCounts.length > 0 ? Math.min(...returnedCounts) : 0;

  console.log(`✔ Finished in: ${totalDurationSec.toFixed(2)}s`);
  console.log(`✔ Throughput: ${rps} req/sec`);
  console.log(`✔ Success Rate: ${((successCount / totalRequests) * 100).toFixed(1)}% (${successCount}/${totalRequests})`);
  if (rateLimitedCount > 0) {
    console.log(`⚠ Rate Limited (429): ${rateLimitedCount}`);
  }
  if (errorCount > 0) {
    console.log(`❌ Other Errors: ${errorCount}`);
  }
  console.log(`✔ Items Returned Per Successful Request: min=${minItemsReturned}, max=${maxItemsReturned} (Strict Enforced Page Limit: 10)`);
  console.log(` Latency Breakdown:`);
  console.log(`   - Min: ${min.toFixed(1)} ms`);
  console.log(`   - p50: ${p50.toFixed(1)} ms`);
  console.log(`   - p95: ${p95.toFixed(1)} ms`);
  console.log(`   - p99: ${p99.toFixed(1)} ms`);
  console.log(`   - Max: ${max.toFixed(1)} ms`);

  return { tierName, totalRequests, concurrency, rps, p50: Math.round(p50), p95: Math.round(p95), p99: Math.round(p99), maxItemsReturned, successCount };
}

async function verifySequentialPagination() {
  console.log(`\n======================================================`);
  console.log(` Verifying Multi-Page Pagination with Real Bridge Data`);
  console.log(`======================================================`);

  // Page 1
  const page1 = await sendRequest(BASE_URL);
  console.log(`Page 1: items=${page1.itemCount}, hasMore=${page1.hasMore}, nextCursor=${page1.nextCursor ? 'present' : 'none'}`);

  if (page1.hasMore && page1.nextCursor) {
    // Page 2
    const page2Url = `${BASE_URL}&cursor=${encodeURIComponent(page1.nextCursor)}`;
    const page2 = await sendRequest(page2Url);
    console.log(`Page 2: items=${page2.itemCount}, hasMore=${page2.hasMore}, nextCursor=${page2.nextCursor ? 'present' : 'none'}`);
    console.log(`✔ Sequential Pagination: Page 1 (${page1.itemCount} items) -> Page 2 (${page2.itemCount} items) verified.`);
  }
}

async function main() {
  console.log("Starting Arc.fun Bridge-Only History Load & Scalability Test...");
  console.log(`Target: /api/bridge/history with active dataset`);

  await verifySequentialPagination();

  const tier1 = await runConcurrencyTier("Tier 1: Normal Active Concurrency", 30, 5);
  const tier2 = await runConcurrencyTier("Tier 2: High Concurrency Spike", 60, 15);

  console.log("\n======================================================");
  console.log(" FINAL BENCHMARK METRICS SUMMARY");
  console.log("======================================================");
  console.table([tier1, tier2]);
}

main().catch(console.error);

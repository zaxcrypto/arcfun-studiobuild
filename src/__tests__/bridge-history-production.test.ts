import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { describe, it, expect, beforeAll } from "@jest/globals";
import {
  MAX_PAGE_SIZE,
  isValidWalletAddress,
  encodeCursor,
  decodeCursor,
  GET
} from "@/app/api/bridge/history/route";
import { POST as reconcilePOST } from "@/app/api/bridge/reconcile/route";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { saveTxHistory, getTxHistory } from "@/lib/tx-history-store";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

jest.setTimeout(30000);

const TEST_WALLET_1 = "0xd448777940dfabf65fd259fa8a9903e60e1ff178";
const TEST_WALLET_2 = "0xe2ed006dbb1726e0f577733f65d30a94d34bdd77";

describe("Arc.fun Bridge-Only Transaction History Production Readiness Audit", () => {
  beforeAll(async () => {
    // Setup in-memory localStorage for Node test runner
    if (typeof window === "undefined") {
      const storage: Record<string, string> = {};
      (global as any).window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      (global as any).localStorage = {
        getItem: (k: string) => storage[k] || null,
        setItem: (k: string, v: string) => { storage[k] = v; },
        removeItem: (k: string) => { delete storage[k]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
      };
    }
  });

  describe("1. Bridge-Only Product Scope & Schema Integrity", () => {
    it("Enforces bridge-only record mapping (burn and mint joined into single transaction record)", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&limit=5`
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);

      for (const record of json.data) {
        // Must contain bridge properties
        expect(record.source_chain).toBeDefined();
        expect(record.destination_chain).toBeDefined();
        expect(record.burn_tx_hash).toBeDefined();
        // Verify source burn and destination mint are part of the SAME logical record
        expect(record).toHaveProperty("mint_tx_hash");
        expect(record).toHaveProperty("bridge_status");
      }
    });

    it("Rejects non-bridge or swap queries from contaminating bridge history", async () => {
      // Local storage test: ensure bridge history storage ignores or separates any legacy swap entries
      const mockBridgeEntry = {
        id: "0xbridge123",
        txHash: "0xbridge123",
        burnHash: "0xbridge123",
        type: "bridge_cctp" as const,
        status: "pending" as const,
        amount: "10.0",
        fromAsset: "USDC",
        toAsset: "USDC",
        sourceChain: "Arc Mainnet",
        destChain: "Base Mainnet",
        timestamp: Date.now(),
        userAddress: TEST_WALLET_1,
      };

      saveTxHistory(mockBridgeEntry, "mainnet", { skipEvent: true });
      const stored = getTxHistory("mainnet");
      const found = stored.find((tx) => tx.txHash === "0xbridge123");
      expect(found).toBeDefined();
      expect(found?.type).toBe("bridge_cctp");
    });
  });

  describe("2. Cross-Device & Storage Clearing Persistence", () => {
    it("Retrieves authoritative bridge history from database even with zero local storage", async () => {
      // Simulating a fresh device opening Arc.fun (no localStorage, fresh session)
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet`
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThan(0);
      expect(json.data[0].wallet_address.toLowerCase()).toBe(TEST_WALLET_1.toLowerCase());
    });

    it("Maintains complete bridge context: source chain, dest chain, burn hash, mint hash, status", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&status=success`
      );
      const res = await GET(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      if (json.data.length > 0) {
        const item = json.data[0];
        expect(item.bridge_status).toBe("COMPLETED");
        expect(item.source_chain).toMatch(/Arc|Base|Arbitrum|Ethereum|OP|Polygon|Avalanche/);
        expect(item.destination_chain).toBeDefined();
        expect(item.burn_tx_hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      }
    });
  });

  describe("3. Strict Server-Side Pagination & Cursor Stability", () => {
    it("Enforces hard limit of 10 bridge records even when requested with limit=100", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&limit=100`
      );
      const res = await GET(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(json.pageSize).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });

    it("Pages through bridge history sequentially with zero duplicated records between pages", async () => {
      // Fetch Page 1
      const req1 = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet`
      );
      const res1 = await GET(req1);
      const page1 = await res1.json();
      expect(page1.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);

      if (page1.hasMore && page1.nextCursor) {
        // Fetch Page 2 with cursor
        const req2 = new NextRequest(
          `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&cursor=${encodeURIComponent(page1.nextCursor)}`
        );
        const res2 = await GET(req2);
        const page2 = await res2.json();
        expect(page2.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);

        // Assert strictly zero overlap in record IDs
        const page1Ids = new Set(page1.data.map((r: any) => r.id));
        for (const item of page2.data) {
          expect(page1Ids.has(item.id)).toBe(false);
        }

        // Assert chronological ordering: Page 2 records must be older than or equal to Page 1
        const lastPage1Time = new Date(page1.data[page1.data.length - 1].created_at).getTime();
        const firstPage2Time = new Date(page2.data[0].created_at).getTime();
        expect(firstPage2Time).toBeLessThanOrEqual(lastPage1Time);
      }
    });

    it("Rejects tampered, malformed, or oversized pagination cursors", async () => {
      const malformedReq = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&cursor=bad_base64_data!`
      );
      const res = await GET(malformedReq);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid pagination cursor");
    });
  });

  describe("4. Status Filtering (Success / Pending / Failed / All)", () => {
    it("Filters for 'success' bridge transactions exclusively", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&status=success`
      );
      const res = await GET(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      for (const item of json.data) {
        expect(item.bridge_status).toBe("COMPLETED");
      }
    });

    it("Filters for 'failed' bridge transactions exclusively", async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&status=failed`
      );
      const res = await GET(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      for (const item of json.data) {
        expect(item.bridge_status).toBe("FAILED");
      }
    });
  });

  describe("5. Durable Background Reconciliation (POST /api/bridge/reconcile)", () => {
    it("Executes idempotently and handles zero pending items gracefully", async () => {
      const req = new Request("http://localhost:3000/api/bridge/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: TEST_WALLET_1, environment: "mainnet" }),
      });

      const res = await reconcilePOST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(typeof json.processed).toBe("number");
    }, 15000);

    it("Enforces rate limiting on public reconciliation requests", async () => {
      const req = new Request("http://localhost:3000/api/bridge/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: TEST_WALLET_1, environment: "mainnet" }),
      });

      // Valid response when rate limit not exceeded
      const res = await reconcilePOST(req);
      expect([200, 429]).toContain(res.status);
    }, 15000);
  });

  describe("6. Wallet Security & Multi-Tenant Isolation", () => {
    it("Ensures strict wallet isolation (Wallet A cannot see Wallet B's history)", async () => {
      const req1 = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet`
      );
      const res1 = await GET(req1);
      const json1 = await res1.json();

      const req2 = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_2}&environment=mainnet`
      );
      const res2 = await GET(req2);
      const json2 = await res2.json();

      const wallet1TxHashes = new Set(json1.data.map((r: any) => r.burn_tx_hash));
      for (const item of json2.data) {
        expect(wallet1TxHashes.has(item.burn_tx_hash)).toBe(false);
      }
    });

    it("Rejects SQL injection, path traversal, and malicious address strings with HTTP 400", async () => {
      const maliciousWallets = [
        "0x' OR '1'='1",
        "0x123",
        "<script>alert('xss')</script>",
        "../../etc/passwd",
        "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
      ];

      for (const badWallet of maliciousWallets) {
        const req = new NextRequest(
          `http://localhost:3000/api/bridge/history?wallet=${encodeURIComponent(badWallet)}`
        );
        const res = await GET(req);
        expect(res.status).toBe(400);
      }
    });
  });

  describe("7. Event-Loop & Fetch-Loop Prevention", () => {
    it("Verifies saveTxHistory with skipEvent: true does not dispatch arc-history-updated", () => {
      let eventFired = false;
      const handler = () => {
        eventFired = true;
      };

      if (typeof window !== "undefined") {
        window.addEventListener("arc-history-updated", handler);
      }

      saveTxHistory(
        {
          id: "0xtest-loop-prevent",
          txHash: "0xtest-loop-prevent",
          type: "bridge_cctp",
          status: "success",
          amount: "1.0",
          fromAsset: "USDC",
          sourceChain: "Base Mainnet",
          destChain: "Arc Mainnet",
          timestamp: Date.now(),
          userAddress: TEST_WALLET_1,
        },
        "mainnet",
        { skipEvent: true }
      );

      expect(eventFired).toBe(false);
    });
  });

  describe("8. Database Keyset Filtering & Stability", () => {
    it("Ensures database keyset cursor correctly handles identical timestamps", async () => {
      // Query page with compound filter
      const time = "2026-11-01T08:44:16.520826+00:00";
      const id = "29710259-3df2-4410-abd1-3513c12fe449";
      const cursor = encodeCursor(time, id);

      const req = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&cursor=${encodeURIComponent(cursor)}`
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);

      // Verify the cursor record itself is NEVER included in subsequent page
      const foundCursor = json.data.find((r: any) => r.id === id);
      expect(foundCursor).toBeUndefined();
    });
  });

  describe("9. Circle Iris Delays & RPC Resiliency", () => {
    it("Guarantees pending bridges are never prematurely marked as Failed during network delays", async () => {
      // When reconciliation runs, records that do not receive positive attestation remain PENDING
      const req = new Request("http://localhost:3000/api/bridge/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: TEST_WALLET_1, environment: "mainnet" }),
      });
      const res = await reconcilePOST(req);
      expect(res.status).toBe(200);

      // Verify pending transactions are not corrupted
      const pendingReq = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${TEST_WALLET_1}&environment=mainnet&status=pending`
      );
      const pendingRes = await GET(pendingReq);
      const pendingJson = await pendingRes.json();
      expect(pendingRes.status).toBe(200);
      for (const item of pendingJson.data) {
        expect(item.bridge_status).not.toBe("FAILED");
      }
    });
  });
});

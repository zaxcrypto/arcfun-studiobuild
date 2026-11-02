import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { describe, it, expect } from "@jest/globals";
import {
  MAX_PAGE_SIZE,
  isValidWalletAddress,
  encodeCursor,
  decodeCursor,
  GET
} from "@/app/api/bridge/history/route";
import { NextRequest } from "next/server";

describe("Arc.fun Transaction History — Performance, Security & Pagination Audit", () => {
  describe("1. Strict Server-Side Pagination & Constraints", () => {
    it("Enforces hard MAX_PAGE_SIZE of 10 records per request", () => {
      expect(MAX_PAGE_SIZE).toBe(10);
    });

    it("Correctly encodes and decodes keyset cursor", () => {
      const createdAt = "2026-11-01T12:00:00.000Z";
      const id = "b7a69b7f-382a-4317-a068-d65fa633c5e8";

      const encoded = encodeCursor(createdAt, id);
      expect(typeof encoded).toBe("string");
      expect(encoded.length).toBeGreaterThan(0);
      // Base64url safe chars only
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

      const decoded = decodeCursor(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded?.created_at).toBe(createdAt);
      expect(decoded?.id).toBe(id);
    });

    it("Safely rejects malformed or tampered cursors without crashing", () => {
      expect(decodeCursor("")).toBeNull();
      expect(decodeCursor("invalid-cursor-string")).toBeNull();
      expect(decodeCursor("!!!@@@###$$$")).toBeNull();
      
      // Delimiter missing
      const noDelimiter = Buffer.from("2026-11-01T12:00:00.000Z").toString("base64url");
      expect(decodeCursor(noDelimiter)).toBeNull();

      // Invalid date inside cursor
      const invalidDate = Buffer.from("not-a-date__some-id").toString("base64url");
      expect(decodeCursor(invalidDate)).toBeNull();

      // Too large / DoS attempt
      const hugeCursor = "A".repeat(300);
      expect(decodeCursor(hugeCursor)).toBeNull();
    });
  });

  describe("2. Wallet Address Format & Injection Protection", () => {
    it("Validates EVM addresses accurately", () => {
      expect(isValidWalletAddress("0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77")).toBe(true);
      expect(isValidWalletAddress("0x0000000000000000000000000000000000000000")).toBe(true);
      expect(isValidWalletAddress("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe(true);
    });

    it("Validates Solana addresses accurately", () => {
      expect(isValidWalletAddress("7v91N7iZ9mNicL8WfG6SZr2g8bS1zL8NfG6SZr2g8bS1")).toBe(true);
      expect(isValidWalletAddress("11111111111111111111111111111111")).toBe(true);
    });

    it("Validates Stellar addresses accurately", () => {
      expect(isValidWalletAddress("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")).toBe(true);
    });

    it("Rejects malicious injection payloads and invalid formats", () => {
      expect(isValidWalletAddress("")).toBe(false);
      expect(isValidWalletAddress("0x123")).toBe(false);
      expect(isValidWalletAddress("0x' OR '1'='1")).toBe(false);
      expect(isValidWalletAddress("<script>alert(1)</script>")).toBe(false);
      expect(isValidWalletAddress("../../etc/passwd")).toBe(false);
      expect(isValidWalletAddress("0xZZZZ000000000000000000000000000000000000")).toBe(false);
    });
  });

  describe("3. GET /api/bridge/history HTTP Endpoint Verification", () => {
    it("Returns HTTP 400 when wallet parameter is missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/bridge/history");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing wallet parameter");
    });

    it("Returns HTTP 400 when wallet address format is invalid", async () => {
      const req = new NextRequest("http://localhost:3000/api/bridge/history?wallet=malicious'--");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid wallet address format");
    });

    it("Returns HTTP 400 when cursor is malformed", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bridge/history?wallet=0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77&cursor=corrupt!!!"
      );
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid pagination cursor");
    });

    it("Returns valid paginated history response with limit clamped to MAX_PAGE_SIZE (10)", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/bridge/history?wallet=0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77&limit=100"
      );
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      // Hard server limit guarantees <= 10 records
      expect(data.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(typeof data.hasMore).toBe("boolean");
      if (data.hasMore) {
        expect(data.nextCursor).toBeDefined();
        expect(typeof data.nextCursor).toBe("string");
      }
    }, 15000);

    it("Demonstrates cursor-based pagination continuity with zero duplicate records across pages", async () => {
      const wallet = "0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77";
      // Request Page 1
      const reqPage1 = new NextRequest(
        `http://localhost:3000/api/bridge/history?wallet=${wallet}`
      );
      const resPage1 = await GET(reqPage1);
      expect(resPage1.status).toBe(200);
      const page1 = await resPage1.json();
      expect(page1.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);

      if (page1.hasMore && page1.nextCursor) {
        // Request Page 2 using nextCursor
        const reqPage2 = new NextRequest(
          `http://localhost:3000/api/bridge/history?wallet=${wallet}&cursor=${encodeURIComponent(page1.nextCursor)}`
        );
        const resPage2 = await GET(reqPage2);
        expect(resPage2.status).toBe(200);
        const page2 = await resPage2.json();
        expect(page2.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);

        // Verify zero overlap between Page 1 and Page 2 records
        const page1Ids = new Set(page1.data.map((tx: any) => tx.id));
        for (const tx of page2.data) {
          expect(page1Ids.has(tx.id)).toBe(false);
        }
      }
    });
  });
});

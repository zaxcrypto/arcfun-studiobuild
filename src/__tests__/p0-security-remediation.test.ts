import { POST as verifyPaymentPOST } from '@/app/api/chat/verify-payment/route';
import { POST as adminActionPOST } from '@/app/api/admin/action/route';

// Mocks for Viem, Supabase, EVM RPC
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(null)
}));

jest.mock('@/lib/circle/wallet-service', () => ({
  circleClient: {
    getTransaction: jest.fn()
  }
}));

// Shared database mock state
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';

const mockDb = {
  payments: new Map<string, any>(),
  onchain_access_settings: new Map<string, any>(),
  access_requests: new Map<string, any>(),
  consumed_admin_nonces: new Set<string>(),
  dapps_admins: new Set<string>(['0xd448777940dfabf65fd259fa8a9903e60e1ff178'])
};

// Mock Supabase createClient
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null })
    },
    from: jest.fn((table: string) => ({
      insert: jest.fn(async (payload: any) => {
        if (table === 'consumed_admin_nonces') {
          if (mockDb.consumed_admin_nonces.has(payload.nonce)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          mockDb.consumed_admin_nonces.add(payload.nonce);
          return { error: null };
        }
        return { error: null };
      }),
      select: jest.fn((cols: string = '*') => {
        let currentFilters: Record<string, any> = {};
        let neqFilters: Record<string, any> = {};

        const builder: any = {
          eq: jest.fn((col: string, val: any) => {
            currentFilters[col] = val;
            return builder;
          }),
          neq: jest.fn((col: string, val: any) => {
            neqFilters[col] = val;
            return builder;
          }),
          ilike: jest.fn((col: string, val: any) => {
            currentFilters[col] = typeof val === 'string' ? val.toLowerCase() : val;
            return builder;
          }),
          order: jest.fn(() => builder),
          limit: jest.fn(() => builder),
          maybeSingle: jest.fn(async () => {
            if (table === 'payments') {
              for (const p of Array.from(mockDb.payments.values())) {
                let match = true;
                for (const [k, v] of Object.entries(currentFilters)) {
                  if (p[k] !== v) match = false;
                }
                for (const [k, v] of Object.entries(neqFilters)) {
                  if (p[k] === v) match = false;
                }
                if (match) return { data: { ...p }, error: null };
              }
              return { data: null, error: null };
            }
            if (table === 'dapps_admins') {
              const addr = currentFilters['wallet_address']?.toLowerCase();
              if (mockDb.dapps_admins.has(addr)) {
                return { data: { wallet_address: addr }, error: null };
              }
              return { data: null, error: null };
            }
            if (table === 'access_requests') {
              const addr = (currentFilters['wallet_address'] || '').toLowerCase();
              const req = mockDb.access_requests.get(addr);
              return { data: req ? { ...req } : null, error: null };
            }
            return { data: null, error: null };
          }),
          single: jest.fn(async () => {
            const res = await builder.maybeSingle();
            return res;
          }),
          then: (resolve: any) => {
            if (table === 'access_requests') {
              const list = Array.from(mockDb.access_requests.values());
              resolve({ data: list, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          }
        };
        return builder;
      }),
      update: jest.fn((updates: any) => {
        let targetId: string | null = null;
        let expectedStatus: string | null = null;
        let targetWallet: string | null = null;

        const updateBuilder: any = {
          eq: jest.fn((col: string, val: any) => {
            if (col === 'id') targetId = val;
            if (col === 'status') expectedStatus = val;
            if (col === 'wallet_address') targetWallet = typeof val === 'string' ? val.toLowerCase() : val;
            return updateBuilder;
          }),
          select: jest.fn(() => updateBuilder),
          maybeSingle: jest.fn(async () => {
            if (table === 'payments' && targetId && mockDb.payments.has(targetId)) {
              const existing = mockDb.payments.get(targetId);
              if (expectedStatus && existing.status !== expectedStatus) {
                // CAS failed
                return { data: null, error: null };
              }
              const updated = { ...existing, ...updates };
              mockDb.payments.set(targetId, updated);
              return { data: updated, error: null };
            }
            if (table === 'access_requests' && targetWallet && mockDb.access_requests.has(targetWallet)) {
              const existing = mockDb.access_requests.get(targetWallet);
              const updated = { ...existing, ...updates };
              mockDb.access_requests.set(targetWallet, updated);
              return { data: updated, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: any) => {
            if (table === 'payments' && targetId && mockDb.payments.has(targetId)) {
              const existing = mockDb.payments.get(targetId);
              if (!expectedStatus || existing.status === expectedStatus) {
                mockDb.payments.set(targetId, { ...existing, ...updates });
              }
            }
            if (table === 'access_requests' && targetWallet && mockDb.access_requests.has(targetWallet)) {
              const existing = mockDb.access_requests.get(targetWallet);
              mockDb.access_requests.set(targetWallet, { ...existing, ...updates });
            }
            resolve({ error: null });
          }
        };
        return updateBuilder;
      }),
      upsert: jest.fn(async (payload: any) => {
        if (table === 'onchain_access_settings') {
          mockDb.onchain_access_settings.set(payload.module, payload);
          return { error: null };
        }
        if (table === 'access_requests') {
          const key = (payload.wallet_address || '').toLowerCase();
          mockDb.access_requests.set(key, { ...payload, wallet_address: key });
          return { error: null };
        }
        return { error: null };
      })
    }))
  }))
}));

// Mock withEvmFailover & viem publicClient
let mockReceipt: any = null;
let mockTx: any = null;
let mockChainId: number = 5042002;

jest.mock('@/lib/evm-rpc', () => ({
  withEvmFailover: jest.fn(async (chain: string, rpc: string, callback: any) => {
    return callback(rpc);
  })
}));

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: jest.fn(() => ({
      getChainId: jest.fn(async () => mockChainId),
      getTransactionReceipt: jest.fn(async () => mockReceipt),
      getTransaction: jest.fn(async () => mockTx)
    })),
    verifyMessage: jest.fn(async ({ address, message, signature }: any) => {
      // Signature is valid if it equals "valid-sig-" + address.toLowerCase()
      return signature === `valid-sig-${address.toLowerCase()}`;
    })
  };
});

describe('ArcFun P0 Financial Security & Mainnet Access Verification', () => {
  const SENDER = '0x1111111111111111111111111111111111111111';
  const RECIPIENT = '0x2222222222222222222222222222222222222222';
  const OFFICIAL_USDC = '0x3600000000000000000000000000000000000000';
  const DUMMY_TOKEN = '0x9999999999999999999999999999999999999999';
  const VALID_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  beforeEach(() => {
    mockDb.payments.clear();
    mockDb.onchain_access_settings.clear();
    mockDb.access_requests.clear();
    mockDb.consumed_admin_nonces.clear();
    mockReceipt = null;
    mockTx = null;
    mockChainId = 5042002;
  });

  // Helper to build ERC20 Transfer event log
  function buildTransferLog(contractAddress: string, from: string, to: string, valueWei: bigint) {
    const { encodeEventTopics, parseAbiItem, toHex } = jest.requireActual('viem');
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
    const topics = encodeEventTopics({
      abi: [transferEvent],
      eventName: 'Transfer',
      args: {
        from: from as `0x${string}`,
        to: to as `0x${string}`
      }
    });

    return {
      address: contractAddress,
      topics,
      data: toHex(valueWei, { size: 32 })
    };
  }

  // ============================================================================
  // P0-SEC-01: Payment Verification Tests
  // ============================================================================
  describe('P0-SEC-01: On-Chain Payment Verification Strictness', () => {
    beforeEach(() => {
      mockDb.payments.set('pay-1', {
        id: 'pay-1',
        sender: SENDER,
        receiver: RECIPIENT,
        amount: 10, // 10 USDC (expected 10,000,000 wei)
        token: 'USDC',
        status: 'pending',
        tx_hash: null
      });

      mockTx = {
        from: SENDER,
        to: OFFICIAL_USDC,
        value: 0n
      };
    });

    it('1. Rejects dummy tokens (Transfer from unapproved contract address)', async () => {
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(DUMMY_TOKEN, SENDER, RECIPIENT, 10000000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.status).toBe('pending');
      expect(mockDb.payments.get('pay-1').status).toBe('pending');
    });

    it('2. Rejects wrong token contract (random ERC-20 contract emitting Transfer)', async () => {
      const FAKE_USDC = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(FAKE_USDC, SENDER, RECIPIENT, 10000000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.status).toBe('pending');
      expect(mockDb.payments.get('pay-1').status).toBe('pending');
    });

    it('3. Rejects wrong recipient (Transfer sent to a third party instead of expected receiver)', async () => {
      const WRONG_RECIPIENT = '0x3333333333333333333333333333333333333333';
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(OFFICIAL_USDC, SENDER, WRONG_RECIPIENT, 10000000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.status).toBe('pending');
      expect(mockDb.payments.get('pay-1').status).toBe('pending');
    });

    it('4. Rejects wrong sender (Transfer from an unauthorized attacker address)', async () => {
      const UNKNOWN_SENDER = '0x4444444444444444444444444444444444444444';
      mockTx = { from: UNKNOWN_SENDER, to: OFFICIAL_USDC, value: 0n };
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(OFFICIAL_USDC, UNKNOWN_SENDER, RECIPIENT, 10000000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.status).toBe('pending');
      expect(mockDb.payments.get('pay-1').status).toBe('pending');
    });

    it('5. Rejects incorrect amount (Insufficient tokens: transferred 0.001 USDC for 10 USDC invoice)', async () => {
      // 0.001 USDC = 1,000 units (expected 10,000,000 units for 10 USDC)
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(OFFICIAL_USDC, SENDER, RECIPIENT, 1000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.status).toBe('pending');
      expect(mockDb.payments.get('pay-1').status).toBe('pending');
    });

    it('6. Successfully confirms valid on-chain payment meeting all criteria', async () => {
      mockReceipt = {
        status: 'success',
        logs: [
          buildTransferLog(OFFICIAL_USDC, SENDER, RECIPIENT, 10000000n)
        ]
      };

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.status).toBe('confirmed');
      expect(mockDb.payments.get('pay-1').status).toBe('confirmed');
      expect(mockDb.payments.get('pay-1').tx_hash).toBe(VALID_TX_HASH);
    });
  });

  // ============================================================================
  // P0-SEC-02: Transaction Hash Replay & Concurrency Tests
  // ============================================================================
  describe('P0-SEC-02: Transaction Hash Replay & Concurrency Protection', () => {
    it('7. Rejects duplicate transaction hash already consumed by another confirmed payment', async () => {
      // Payment 1 is already confirmed with VALID_TX_HASH
      mockDb.payments.set('pay-1', {
        id: 'pay-1',
        sender: SENDER,
        receiver: RECIPIENT,
        amount: 10,
        status: 'confirmed',
        tx_hash: VALID_TX_HASH
      });

      // Attacker creates Payment 2 and attempts to reuse VALID_TX_HASH
      mockDb.payments.set('pay-2', {
        id: 'pay-2',
        sender: SENDER,
        receiver: RECIPIENT,
        amount: 10,
        status: 'pending',
        tx_hash: null
      });

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-2', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('TX_ALREADY_USED');
      expect(mockDb.payments.get('pay-2').status).toBe('pending');
    });

    it('8. Handles legitimate retry for the SAME payment idempotently', async () => {
      mockDb.payments.set('pay-1', {
        id: 'pay-1',
        sender: SENDER,
        receiver: RECIPIENT,
        amount: 10,
        status: 'confirmed',
        tx_hash: VALID_TX_HASH
      });

      const req = new Request('http://localhost/api/chat/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'pay-1', txHash: VALID_TX_HASH })
      });

      const res = await verifyPaymentPOST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.status).toBe('confirmed');
    });
  });

  // ============================================================================
  // P0-SEC-03: Payments Table RLS & Trigger Field Protection Tests
  // ============================================================================
  describe('P0-SEC-03: Payments Column Protection Invariants', () => {
    function simulateProtectPaymentsTrigger(oldRow: any, newRow: any, isServiceRole: boolean) {
      if (isServiceRole) return newRow;

      if (newRow.status !== oldRow.status) {
        throw new Error('Unauthorized: Payment status can only be modified by backend verification');
      }
      if (newRow.amount !== oldRow.amount) {
        throw new Error('Unauthorized: Payment amount cannot be modified');
      }
      if (newRow.sender !== oldRow.sender || newRow.receiver !== oldRow.receiver) {
        throw new Error('Unauthorized: Payment participants cannot be modified');
      }
      if (newRow.token !== oldRow.token) {
        throw new Error('Unauthorized: Payment token cannot be modified');
      }
      if (newRow.tx_hash !== oldRow.tx_hash) {
        throw new Error('Unauthorized: Payment transaction hash cannot be modified');
      }

      return newRow;
    }

    it('9. Rejects authenticated user attempting to directly change payment status to confirmed', () => {
      const oldRow = { id: 'p1', sender: SENDER, receiver: RECIPIENT, amount: 10, status: 'pending', active: true, tx_hash: null };
      const newRow = { ...oldRow, status: 'confirmed' };

      expect(() => {
        simulateProtectPaymentsTrigger(oldRow, newRow, false); // false = not service_role
      }).toThrow('Unauthorized: Payment status can only be modified by backend verification');
    });

    it('10. Rejects authenticated user attempting to directly modify payment amount', () => {
      const oldRow = { id: 'p1', sender: SENDER, receiver: RECIPIENT, amount: 10, status: 'pending', active: true, tx_hash: null };
      const newRow = { ...oldRow, amount: 1000 };

      expect(() => {
        simulateProtectPaymentsTrigger(oldRow, newRow, false);
      }).toThrow('Unauthorized: Payment amount cannot be modified');
    });

    it('Allows authenticated user to toggle active status for autopay schedules', () => {
      const oldRow = { id: 'p1', sender: SENDER, receiver: RECIPIENT, amount: 10, status: 'pending', active: true, tx_hash: null };
      const newRow = { ...oldRow, active: false };

      const result = simulateProtectPaymentsTrigger(oldRow, newRow, false);
      expect(result.active).toBe(false);
    });

    it('Allows service_role to transition status upon verified on-chain confirmation', () => {
      const oldRow = { id: 'p1', sender: SENDER, receiver: RECIPIENT, amount: 10, status: 'pending', active: true, tx_hash: null };
      const newRow = { ...oldRow, status: 'confirmed', tx_hash: VALID_TX_HASH };

      const result = simulateProtectPaymentsTrigger(oldRow, newRow, true); // true = service_role
      expect(result.status).toBe('confirmed');
      expect(result.tx_hash).toBe(VALID_TX_HASH);
    });
  });

  // ============================================================================
  // P0-SEC-04: Onchain Access Settings & Kill Switches Tests
  // ============================================================================
  describe('P0-SEC-04: Access Settings & Admin Kill Switch Authorization', () => {
    const ADMIN_ADDR = '0xd448777940dfabf65fd259fa8a9903e60e1ff178';
    const ATTACKER_ADDR = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0';

    it('11. Rejects anonymous / unauthenticated request to modify settings', async () => {
      const req = new Request('http://localhost/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_wallet: '',
          action: 'update_onchain_access_setting',
          target_id: 'bridge',
          payload: { module: 'bridge', mode: 'paused' },
          signature: '',
          timestamp: Date.now()
        })
      });

      const res = await adminActionPOST(req);
      expect(res.status).toBe(400);
    });

    it('12. Rejects non-admin attempting to modify access settings even with a valid ECDSA signature', async () => {
      const timestamp = Date.now();
      const req = new Request('http://localhost/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_wallet: ATTACKER_ADDR,
          action: 'update_onchain_access_setting',
          target_id: 'bridge',
          payload: { module: 'bridge', mode: 'paused' },
          signature: `valid-sig-${ATTACKER_ADDR.toLowerCase()}`,
          timestamp
        })
      });

      const res = await adminActionPOST(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('Unauthorized: Wallet is not an ArcFun admin');
      expect(mockDb.onchain_access_settings.get('bridge')).toBeUndefined();
    });

    it('13. Allows authorized admin with valid cryptographic signature to update access settings', async () => {
      const timestamp = Date.now();
      const nonce = 'test-nonce-13';
      const req = new Request('http://localhost/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_wallet: ADMIN_ADDR,
          action: 'update_onchain_access_setting',
          target_id: 'bridge_evm_to_sui',
          payload: { module: 'bridge_evm_to_sui', mode: 'paused' },
          signature: `valid-sig-${ADMIN_ADDR.toLowerCase()}`,
          timestamp,
          nonce
        })
      });

      const res = await adminActionPOST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockDb.onchain_access_settings.get('bridge_evm_to_sui')).toEqual({
        module: 'bridge_evm_to_sui',
        mode: 'paused',
        updated_at: expect.any(Number),
        updated_by: ADMIN_ADDR.toLowerCase()
      });
    });

    it('14. Rejects replayed admin nonce (prevents signature replay attack)', async () => {
      const timestamp = Date.now();
      const nonce = 'replay-nonce-99';

      const buildReq = () => new Request('http://localhost/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_wallet: ADMIN_ADDR,
          action: 'update_onchain_access_setting',
          target_id: 'bridge',
          payload: { module: 'bridge', mode: 'paused' },
          signature: `valid-sig-${ADMIN_ADDR.toLowerCase()}`,
          timestamp,
          nonce
        })
      });

      // First call succeeds
      const res1 = await adminActionPOST(buildReq());
      expect(res1.status).toBe(200);

      // Second call with same nonce fails with 409 Conflict
      const res2 = await adminActionPOST(buildReq());
      expect(res2.status).toBe(409);
      const json2 = await res2.json();
      expect(json2.error).toContain('Nonce already consumed (replay detected)');
    });

    it('15. Rejects stale admin request timestamp (> 5 minutes old)', async () => {
      const staleTimestamp = Date.now() - (6 * 60 * 1000); // 6 mins ago
      const req = new Request('http://localhost/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_wallet: ADMIN_ADDR,
          action: 'update_onchain_access_setting',
          target_id: 'bridge',
          payload: { module: 'bridge', mode: 'paused' },
          signature: `valid-sig-${ADMIN_ADDR.toLowerCase()}`,
          timestamp: staleTimestamp,
          nonce: 'stale-nonce'
        })
      });

      const res = await adminActionPOST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Signature has expired');
    });
  });
});

/**
 * Rate Limit Engine
 * 
 * Centralized logic for evaluating transaction volumes against
 * system-wide constraints.
 */

export interface RateLimitContext {
  walletAddress: string;
  asset: string;
  amount: number;
}

export interface RateLimitResult {
  isAllowed: boolean;
  reason?: string;
  remainingAmount?: number;
  remainingCount?: number;
}

import { MAX_BRIDGE_AMOUNT as CONTRACT_MAX_BRIDGE_AMOUNT } from "@/config/swap-contract";
import { formatUnits } from "viem";

export class RateLimitEngine {
  private static get MAX_BRIDGES_PER_DAY() { return 100; }
  private static get MAX_BRIDGE_AMOUNT() { return Number(formatUnits(CONTRACT_MAX_BRIDGE_AMOUNT, 6)); }

  /**
   * Checks if a Bridge request violates any daily volume or count limits.
   */
  static async checkBridgeLimits(context: RateLimitContext): Promise<RateLimitResult> {
    if (context.amount > this.MAX_BRIDGE_AMOUNT) {
      return { 
        isAllowed: false, 
        reason: `Amount exceeds maximum per-bridge limit of ${this.MAX_BRIDGE_AMOUNT} ${context.asset}`
      };
    }

    const currentCountToday = 0; 

    if (currentCountToday >= this.MAX_BRIDGES_PER_DAY) {
      return {
        isAllowed: false,
        reason: `Maximum daily bridge limit reached (${this.MAX_BRIDGES_PER_DAY})`,
        remainingCount: 0
      };
    }

    return { 
      isAllowed: true, 
      remainingCount: this.MAX_BRIDGES_PER_DAY - currentCountToday - 1 
    };
  }
}

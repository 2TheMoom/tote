import { createClient } from "genlayer-js";
import { getGenLayerChain } from "../genlayer/chains";
import type { Market } from "./types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";

/**
 * genlayer-js decodes Python dicts (and dataclasses) as JS Map instances,
 * keyed by field name. This flattens one level of the Map into a plain
 * object.
 */
function toPlainObject(raw: any): Record<string, any> {
  const entries = raw instanceof Map ? Array.from(raw.entries()) : Object.entries(raw ?? {});
  const obj: Record<string, any> = {};
  for (const [key, value] of entries) {
    obj[key] = value;
  }
  return obj;
}

function decodeMarket(raw: any): Market {
  const obj = toPlainObject(raw);
  return {
    creator: String(obj.creator ?? ""),
    question: String(obj.question ?? ""),
    verification_url: String(obj.verification_url ?? ""),
    yes_marker: String(obj.yes_marker ?? ""),
    no_marker: String(obj.no_marker ?? ""),
    lock_time: String(obj.lock_time ?? "0"),
    resolve_after: String(obj.resolve_after ?? "0"),
    status: String(obj.status ?? "open") as Market["status"],
    outcome: String(obj.outcome ?? "") as Market["outcome"],
    resolved_at: String(obj.resolved_at ?? "0"),
    challenge_deadline: String(obj.challenge_deadline ?? "0"),
    dispute_reason: String(obj.dispute_reason ?? ""),
    resolution_note: String(obj.resolution_note ?? ""),
    total_yes_pool: String(obj.total_yes_pool ?? "0"),
    total_no_pool: String(obj.total_no_pool ?? "0"),
  };
}

/**
 * Tote contract class - a verifiable pari-mutuel prediction market.
 * stake is the only payable write (it adds to a market's pool); every
 * other write only moves a market between states or pays out a claim.
 */
class Tote {
  private contractAddress: `0x${string}`;
  private client: any;
  private rpcUrl?: string;

  constructor(contractAddress: string, address?: string | null, rpcUrl?: string) {
    this.contractAddress = contractAddress as `0x${string}`;
    this.rpcUrl = rpcUrl;

    const config: any = { chain: getGenLayerChain() };
    if (address) config.account = address as `0x${string}`;
    if (rpcUrl) config.endpoint = rpcUrl;

    this.client = createClient(config);
  }

  updateAccount(address: string): void {
    const config: any = { chain: getGenLayerChain(), account: address as `0x${string}` };
    if (this.rpcUrl) config.endpoint = this.rpcUrl;
    this.client = createClient(config);
  }

  private async estimateFees(
    functionName: string,
    args: unknown[],
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(this.client, { address: this.contractAddress, functionName, args }, level);
  }

  async getMarket(marketId: string): Promise<Market | null> {
    try {
      const result = await this.client.readContract({
        address: this.contractAddress, functionName: "get_market", args: [marketId],
      });
      return decodeMarket(result);
    } catch {
      return null;
    }
  }

  async getAllMarketIds(): Promise<string[]> {
    const result: any = await this.client.readContract({
      address: this.contractAddress, functionName: "get_all_market_ids", args: [],
    });
    return Array.isArray(result) ? result.map(String) : [];
  }

  async getStake(marketId: string, side: "yes" | "no", wallet: string): Promise<bigint> {
    const result = await this.client.readContract({
      address: this.contractAddress, functionName: "get_stake", args: [marketId, side, wallet],
    });
    return BigInt(result ?? 0);
  }

  async hasClaimed(marketId: string, wallet: string): Promise<boolean> {
    const result = await this.client.readContract({
      address: this.contractAddress, functionName: "has_claimed", args: [marketId, wallet],
    });
    return Boolean(result);
  }

  async getYesStakers(marketId: string): Promise<string[]> {
    const result: any = await this.client.readContract({
      address: this.contractAddress, functionName: "get_yes_stakers", args: [marketId],
    });
    return Array.isArray(result) ? result.map(String) : [];
  }

  async getNoStakers(marketId: string): Promise<string[]> {
    const result: any = await this.client.readContract({
      address: this.contractAddress, functionName: "get_no_stakers", args: [marketId],
    });
    return Array.isArray(result) ? result.map(String) : [];
  }

  private async submitWrite(
    functionName: string,
    args: unknown[],
    feePreset?: FeePresetEstimate,
    onSubmitted?: (txHash: string) => void,
    value: bigint = BigInt(0)
  ): Promise<string> {
    const fees = feePresetToTransactionFees(feePreset);
    let txHash: string;
    try {
      txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName,
        args,
        value,
        ...(fees ? { fees } : {}),
      });
    } catch (error) {
      console.error(`Error calling ${functionName}:`, error);
      throw new Error(`Failed to submit the ${functionName} transaction. Please try again.`);
    }

    onSubmitted?.(txHash);

    try {
      await this.client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" as any, retries: 40, interval: 5000 });
      return txHash;
    } catch (error) {
      console.error(`Error confirming ${functionName} transaction:`, error);
      throw new Error(
        `Transaction ${txHash} was submitted but confirmation timed out. It may still complete - check the explorer.`
      );
    }
  }

  async estimateCreateMarketFees(
    marketId: string, question: string, url: string, yesMarker: string, noMarker: string,
    lockTime: number, resolveAfter: number, level: FeePresetLevel = "standard"
  ) {
    return this.estimateFees("create_market", [marketId, question, url, yesMarker, noMarker, lockTime, resolveAfter], level);
  }

  async createMarket(
    marketId: string, question: string, url: string, yesMarker: string, noMarker: string,
    lockTime: number, resolveAfter: number,
    feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void
  ) {
    return this.submitWrite(
      "create_market",
      [marketId, question, url, yesMarker, noMarker, lockTime, resolveAfter],
      feePreset, onSubmitted
    );
  }

  async estimateStakeFees(marketId: string, side: "yes" | "no", level: FeePresetLevel = "standard") {
    return this.estimateFees("stake", [marketId, side], level);
  }

  async stake(marketId: string, side: "yes" | "no", amountWei: bigint, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("stake", [marketId, side], feePreset, onSubmitted, amountWei);
  }

  async estimateResolveFees(marketId: string, level: FeePresetLevel = "standard") {
    return this.estimateFees("resolve", [marketId], level);
  }

  async resolve(marketId: string, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("resolve", [marketId], feePreset, onSubmitted);
  }

  async estimateChallengeFees(marketId: string, reason: string, level: FeePresetLevel = "standard") {
    return this.estimateFees("challenge", [marketId, reason], level);
  }

  async challenge(marketId: string, reason: string, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("challenge", [marketId, reason], feePreset, onSubmitted);
  }

  async estimateResolveDisputeFees(marketId: string, level: FeePresetLevel = "standard") {
    return this.estimateFees("resolve_dispute", [marketId], level);
  }

  async resolveDispute(marketId: string, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("resolve_dispute", [marketId], feePreset, onSubmitted);
  }

  async estimateFinalizeFees(marketId: string, level: FeePresetLevel = "standard") {
    return this.estimateFees("finalize", [marketId], level);
  }

  async finalize(marketId: string, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("finalize", [marketId], feePreset, onSubmitted);
  }

  async estimateClaimFees(marketId: string, level: FeePresetLevel = "standard") {
    return this.estimateFees("claim", [marketId], level);
  }

  async claim(marketId: string, feePreset?: FeePresetEstimate, onSubmitted?: (txHash: string) => void) {
    return this.submitWrite("claim", [marketId], feePreset, onSubmitted);
  }
}

export default Tote;

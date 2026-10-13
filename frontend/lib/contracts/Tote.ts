import { createClient } from "genlayer-js";
import { getGenLayerChain } from "../genlayer/chains";
import type { Market } from "./types";
import { decodeMarket } from "./decode";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";
import { expectedStatus, movesFunds, type MarketAction, type Position } from "../market-actions";

/** Where a write is in its life. Only "confirmed" means the contract state really changed. */
export type WriteStage = "signing" | "submitted" | "accepted" | "confirmed" | "finalized";

export interface WriteProgress {
  txHash?: string;
  stage: WriteStage;
  /** true when funds only move once the transaction finalizes */
  movesFunds: boolean;
}

interface WriteOptions {
  action: MarketAction | "create";
  marketId: string;
  value?: bigint;
  /** Extra check run after the status check, for writes that change a wallet's position rather than the market's status. */
  confirm?: () => Promise<boolean>;
  feePreset?: FeePresetEstimate;
  onProgress?: (p: WriteProgress) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CreateArgs {
  id: string;
  question: string;
  url: string;
  yesMarker: string;
  noMarker: string;
  lockTime: number;
  resolveAfter: number;
  challengeWindow: number;
  staleAfter: number;
}

/**
 * Tote contract client.
 *
 * Reads use an account-free client. Writes use a second client that carries
 * the injected wallet provider and is connected to the chain before signing,
 * as the GenLayerJS docs prescribe for browser wallets.
 *
 * A write is only reported as done after three checks: the transaction was
 * accepted, its GenVM execution returned (an ACCEPTED transaction can still
 * have reverted), and reading the contract back shows the expected change.
 * Fund-moving writes then keep watching until FINALIZED, because transfers
 * are only delivered on finalization.
 */
class Tote {
  private contractAddress: `0x${string}`;
  private readClient: any;
  private writeClient: any = null;
  private connectedFor: string | null = null;
  private address?: string | null;
  private rpcUrl?: string;

  constructor(contractAddress: string, address?: string | null, rpcUrl?: string) {
    this.contractAddress = contractAddress as `0x${string}`;
    this.rpcUrl = rpcUrl;
    this.address = address;
    const config: any = { chain: getGenLayerChain() };
    if (rpcUrl) config.endpoint = rpcUrl;
    this.readClient = createClient(config);
  }

  updateAccount(address: string): void {
    this.address = address;
    this.writeClient = null;
    this.connectedFor = null;
  }

  private async writer(): Promise<any> {
    if (!this.address) throw new Error("Wallet not connected. Please connect your wallet first.");
    const provider = typeof window !== "undefined" ? (window as any).ethereum : undefined;
    if (!provider) throw new Error("No wallet found. Install MetaMask to sign transactions.");
    if (!this.writeClient || this.connectedFor !== this.address) {
      const config: any = { chain: getGenLayerChain(), account: this.address as `0x${string}`, provider };
      if (this.rpcUrl) config.endpoint = this.rpcUrl;
      const client = createClient(config);
      await client.connect("testnetBradbury");
      this.writeClient = client;
      this.connectedFor = this.address;
    }
    return this.writeClient;
  }

  private async read(functionName: string, args: unknown[]): Promise<any> {
    return this.readClient.readContract({ address: this.contractAddress, functionName, args });
  }

  async getMarket(marketId: string): Promise<Market | null> {
    try {
      return decodeMarket(await this.read("get_market", [marketId]));
    } catch {
      return null;
    }
  }

  async getMarketCount(): Promise<number> {
    return Number((await this.read("get_market_count", [])) ?? 0);
  }

  /** One page (at most 50) of ids, oldest first. */
  async getMarketIds(offset: number, limit: number): Promise<string[]> {
    const result: any = await this.read("get_market_ids", [offset, limit]);
    return Array.isArray(result) ? result.map(String) : [];
  }

  /** The newest `limit` ids, oldest first within that page, read from the end so a long history never has to be loaded. */
  async getRecentMarketIds(limit = 20): Promise<string[]> {
    const count = await this.getMarketCount();
    if (count === 0) return [];
    const start = Math.max(0, count - limit);
    return this.getMarketIds(start, count - start);
  }

  async getStake(marketId: string, side: "yes" | "no", wallet: string): Promise<bigint> {
    return BigInt((await this.read("get_stake", [marketId, side, wallet])) ?? 0);
  }

  async getClaimPayout(marketId: string, wallet: string): Promise<bigint> {
    return BigInt((await this.read("get_claim_payout", [marketId, wallet])) ?? 0);
  }

  async getReclaimPayout(marketId: string, side: "yes" | "no", wallet: string): Promise<bigint> {
    return BigInt((await this.read("get_reclaim_payout", [marketId, side, wallet])) ?? 0);
  }

  /** Stakes plus claim/reclaim state. A payout record exists exactly when that transfer has been scheduled. */
  async getPosition(marketId: string, wallet: string): Promise<Position> {
    const [yesStake, noStake, claim, reclaimYes, reclaimNo] = await Promise.all([
      this.getStake(marketId, "yes", wallet),
      this.getStake(marketId, "no", wallet),
      this.getClaimPayout(marketId, wallet),
      this.getReclaimPayout(marketId, "yes", wallet),
      this.getReclaimPayout(marketId, "no", wallet),
    ]);
    const zero = BigInt(0);
    return { yesStake, noStake, claimed: claim > zero, reclaimedYes: reclaimYes > zero, reclaimedNo: reclaimNo > zero };
  }

  private async estimateFees(functionName: string, args: unknown[], level: FeePresetLevel = "standard") {
    const client = await this.writer();
    return estimateWriteFeePreset(client, { address: this.contractAddress, functionName, args }, level);
  }

  /** Poll until the market (and any extra check) reads back as expected. Reads can lag a just-accepted write. */
  private async confirmState(opts: WriteOptions, tries = 24): Promise<void> {
    const statusOk = expectedStatus(opts.action as any);
    let last: Market | null = null;
    for (let i = 0; i < tries; i++) {
      last = await this.getMarket(opts.marketId);
      const okStatus = !statusOk || (last !== null && statusOk(last));
      const okExtra = !opts.confirm || (await opts.confirm().catch(() => false));
      if (last && okStatus && okExtra) return;
      await sleep(5000);
    }
    throw new Error(
      `The transaction was accepted but the market still reads "${last?.status ?? "unknown"}". ` +
        "It may have been refused by the contract (for example the evidence did not resolve it). Check the explorer before retrying."
    );
  }

  private async submitWrite(functionName: string, args: unknown[], opts: WriteOptions): Promise<string> {
    const pays = movesFunds(opts.action);
    const progress = (stage: WriteStage, txHash?: string) => opts.onProgress?.({ stage, txHash, movesFunds: pays });
    const client = await this.writer();
    const fees = feePresetToTransactionFees(opts.feePreset);

    progress("signing");
    let txHash: string;
    try {
      txHash = await client.writeContract({
        address: this.contractAddress,
        functionName,
        args,
        value: opts.value ?? BigInt(0),
        ...(fees ? { fees } : {}),
      });
    } catch (error: any) {
      console.error(`Error calling ${functionName}:`, error);
      const rejected = error?.code === 4001 || /reject|denied/i.test(String(error?.message ?? ""));
      throw new Error(rejected ? "You rejected the transaction in your wallet." : `Failed to submit the ${functionName} transaction. Please try again.`);
    }
    progress("submitted", txHash);

    let receipt: any;
    try {
      receipt = await client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED" as any, retries: 60, interval: 5000 });
    } catch (error) {
      console.error(`Error confirming ${functionName} transaction:`, error);
      throw new Error(`Transaction ${txHash} was submitted but is not accepted yet. It may still complete: check the explorer.`);
    }
    // ACCEPTED only says validators agreed on a result, which can be a revert.
    if (receipt?.txExecutionResultName && receipt.txExecutionResultName !== "FINISHED_WITH_RETURN") {
      throw new Error(`The contract refused ${functionName} (${receipt.txExecutionResultName}). Nothing changed. Transaction ${txHash}.`);
    }
    progress("accepted", txHash);

    await this.confirmState(opts);
    progress("confirmed", txHash);

    if (pays) {
      void (async () => {
        for (let i = 0; i < 8; i++) {
          try {
            await this.readClient.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED" as any, retries: 400, interval: 10000 });
            progress("finalized", txHash);
            return;
          } catch {
            await sleep(15000);
          }
        }
      })();
    }
    return txHash;
  }

  private createArgs(a: CreateArgs): unknown[] {
    return [a.id, a.question, a.url, a.yesMarker, a.noMarker, a.lockTime, a.resolveAfter, a.challengeWindow, a.staleAfter];
  }

  async estimateCreateMarketFees(a: CreateArgs, level: FeePresetLevel = "standard") {
    return this.estimateFees("create_market", this.createArgs(a), level);
  }

  async createMarket(a: CreateArgs, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("create_market", this.createArgs(a), { action: "create", marketId: a.id, onProgress });
  }

  /** Confirmed by the wallet's stake on that side growing by the amount sent. */
  async stake(marketId: string, side: "yes" | "no", amountWei: bigint, wallet: string, onProgress?: WriteOptions["onProgress"]) {
    const before = await this.getStake(marketId, side, wallet);
    return this.submitWrite("stake", [marketId, side], {
      action: "stake", marketId, value: amountWei, onProgress,
      confirm: async () => (await this.getStake(marketId, side, wallet)) >= before + amountWei,
    });
  }

  async resolve(marketId: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("resolve", [marketId], { action: "resolve", marketId, onProgress });
  }

  /** The bond is sent with the call and must equal 5% of all stakes exactly. */
  async challenge(marketId: string, reason: string, bondWei: bigint, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("challenge", [marketId, reason], { action: "challenge", marketId, value: bondWei, onProgress });
  }

  async resolveDispute(marketId: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("resolve_dispute", [marketId], { action: "resolve_dispute", marketId, onProgress });
  }

  async finalize(marketId: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("finalize", [marketId], { action: "finalize", marketId, onProgress });
  }

  /** Confirmed by the wallet's payout record appearing (it exists exactly when the transfer was scheduled). */
  async claim(marketId: string, wallet: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("claim", [marketId], {
      action: "claim", marketId, onProgress,
      confirm: async () => (await this.getClaimPayout(marketId, wallet)) > BigInt(0),
    });
  }

  /** Returns an overturned challenger's bond. Permissionless, and confirmed by the contract's own refund record. */
  async claimBond(marketId: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("claim_bond", [marketId], {
      action: "claim_bond", marketId, onProgress,
      confirm: async () => (await this.getMarket(marketId))?.bond_refunded === true,
    });
  }

  async resolveStaleDispute(marketId: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("resolve_stale_dispute", [marketId], { action: "resolve_stale_dispute", marketId, onProgress });
  }

  async reclaimStake(marketId: string, side: "yes" | "no", wallet: string, onProgress?: WriteOptions["onProgress"]) {
    return this.submitWrite("reclaim_stake", [marketId, side], {
      action: side === "yes" ? "reclaim_yes" : "reclaim_no", marketId, onProgress,
      confirm: async () => (await this.getReclaimPayout(marketId, side, wallet)) > BigInt(0),
    });
  }
}

export default Tote;

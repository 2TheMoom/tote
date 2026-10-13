"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Tote, { type CreateArgs, type WriteProgress } from "../contracts/Tote";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import { success, error, configError } from "../utils/toast";
import type { Market } from "../contracts/types";
import { EMPTY_POSITION, type Position } from "../market-actions";

export type { WriteProgress };

export function useToteContract(): Tote | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const rpcUrl = getStudioUrl();

  const contract = useMemo(() => {
    if (!contractAddress) {
      configError(
        "Setup Required",
        "Contract address not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file.",
        { label: "Setup Guide", onClick: () => window.open("/docs/setup", "_blank") }
      );
      return null;
    }
    return new Tote(contractAddress, address, rpcUrl);
  }, [contractAddress, address, rpcUrl]);

  return contract;
}

export function useMarket(marketId: string) {
  const contract = useToteContract();

  return useQuery<Market | null, Error>({
    queryKey: ["market", marketId],
    queryFn: () => (contract ? contract.getMarket(marketId) : Promise.resolve(null)),
    refetchOnWindowFocus: true,
    refetchInterval: 20000,
    staleTime: 2000,
    enabled: !!contract && !!marketId,
  });
}

/** The newest market ids (one page from the end of the list, never the whole history). */
export function useRecentMarketIds(limit = 20) {
  const contract = useToteContract();

  return useQuery<string[], Error>({
    queryKey: ["marketIds", limit],
    queryFn: () => (contract ? contract.getRecentMarketIds(limit) : Promise.resolve([])),
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
    staleTime: 2000,
    enabled: !!contract,
  });
}

export function useMarketList() {
  const contract = useToteContract();
  const idsQuery = useRecentMarketIds();

  const listQuery = useQuery<Array<{ id: string; market: Market }>, Error>({
    queryKey: ["marketList", idsQuery.data],
    queryFn: async () => {
      if (!contract || !idsQuery.data) return [];
      const results = await Promise.all(
        idsQuery.data.map(async (id) => ({ id, market: await contract.getMarket(id) }))
      );
      return results.filter((r): r is { id: string; market: Market } => r.market !== null);
    },
    enabled: !!contract && !!idsQuery.data,
    staleTime: 2000,
  });

  return { ...listQuery, isLoading: idsQuery.isLoading || listQuery.isLoading };
}

/** The connected wallet's stakes, claim and reclaim state in one market. */
export function useMyPosition(marketId: string, wallet: string | null) {
  const contract = useToteContract();

  return useQuery<Position, Error>({
    queryKey: ["position", marketId, wallet],
    queryFn: async () => {
      if (!contract || !wallet) return EMPTY_POSITION;
      return contract.getPosition(marketId, wallet);
    },
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract && !!marketId && !!wallet,
  });
}

type Runner<TArgs> = (contract: Tote, args: TArgs, wallet: string, onProgress: (p: WriteProgress) => void) => Promise<string>;

function useWriteAction<TArgs>(
  action: Runner<TArgs>,
  messages: { confirmed: { title: string; description: string }; finalized?: { title: string; description: string } },
  errorTitle: string,
  getMarketId: (args: TArgs) => string
) {
  const contract = useToteContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState<WriteProgress | null>(null);

  const refresh = (marketId: string) => {
    queryClient.invalidateQueries({ queryKey: ["market", marketId] });
    queryClient.invalidateQueries({ queryKey: ["marketIds"] });
    queryClient.invalidateQueries({ queryKey: ["marketList"] });
    queryClient.invalidateQueries({ queryKey: ["position", marketId] });
  };

  const mutation = useMutation({
    mutationFn: async (args: TArgs) => {
      if (!contract) throw new Error("Contract not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file.");
      if (!address) throw new Error("Wallet not connected. Please connect your wallet first.");
      setIsPending(true);
      setProgress(null);
      const id = getMarketId(args);
      return action(contract, args, address, (p) => {
        setProgress(p);
        if (p.stage === "finalized") {
          refresh(id);
          if (messages.finalized) success(messages.finalized.title, { description: messages.finalized.description });
        }
      });
    },
    onSuccess: (_data, args) => {
      refresh(getMarketId(args));
      setIsPending(false);
      success(messages.confirmed.title, { description: messages.confirmed.description });
    },
    onError: (err: any) => {
      console.error(errorTitle, err);
      setIsPending(false);
      setProgress(null);
      error(errorTitle, { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isPending,
    progress,
    clearProgress: () => setProgress(null),
    run: mutation.mutate,
  };
}

const PAYS = "Funds are delivered when the transaction finalizes (about 30 minutes on Bradbury).";

export function useCreateMarket() {
  return useWriteAction<CreateArgs>(
    (c, a, _w, onProgress) => c.createMarket(a, onProgress),
    { confirmed: { title: "Market opened", description: "Staking is now live." } },
    "Failed to create market",
    (a) => a.id
  );
}

export function useStake() {
  return useWriteAction<{ id: string; side: "yes" | "no"; amountWei: bigint }>(
    (c, a, w, onProgress) => c.stake(a.id, a.side, a.amountWei, w, onProgress),
    { confirmed: { title: "Staked", description: "Your position reads back on-chain." } },
    "Failed to stake",
    (a) => a.id
  );
}

export function useResolve() {
  return useWriteAction<{ id: string }>(
    (c, a, _w, onProgress) => c.resolve(a.id, onProgress),
    { confirmed: { title: "Resolved", description: "Validators agreed on exactly one marker line. The excerpt and its hash are recorded." } },
    "Resolution did not go through",
    (a) => a.id
  );
}

export function useChallenge() {
  return useWriteAction<{ id: string; reason: string; bondWei: bigint }>(
    (c, a, _w, onProgress) => c.challenge(a.id, a.reason, a.bondWei, onProgress),
    { confirmed: { title: "Challenge filed", description: "Your bond is held until the dispute is settled." } },
    "Failed to challenge",
    (a) => a.id
  );
}

export function useResolveDispute() {
  return useWriteAction<{ id: string }>(
    (c, a, _w, onProgress) => c.resolveDispute(a.id, onProgress),
    {
      confirmed: { title: "Verdict recorded", description: "Claims are open once this finalizes. If the outcome was overturned the challenger's bond is returned." },
      finalized: { title: "Dispute settled", description: "The transaction finalized." },
    },
    "Failed to resolve dispute",
    (a) => a.id
  );
}

export function useFinalize() {
  return useWriteAction<{ id: string }>(
    (c, a, _w, onProgress) => c.finalize(a.id, onProgress),
    { confirmed: { title: "Finalized", description: "Claims are now open." } },
    "Failed to finalize",
    (a) => a.id
  );
}

export function useClaim() {
  return useWriteAction<{ id: string }>(
    (c, a, w, onProgress) => c.claim(a.id, w, onProgress),
    {
      confirmed: { title: "Claim recorded", description: PAYS },
      finalized: { title: "Paid", description: "The transaction finalized and your winnings were delivered." },
    },
    "Failed to claim",
    (a) => a.id
  );
}

export function useResolveStaleDispute() {
  return useWriteAction<{ id: string }>(
    (c, a, _w, onProgress) => c.resolveStaleDispute(a.id, onProgress),
    { confirmed: { title: "Market settled", description: "The recorded outcome stands and the challenger's bond goes to the winners." } },
    "Failed to settle the stuck dispute",
    (a) => a.id
  );
}

export function useReclaimStake() {
  return useWriteAction<{ id: string; side: "yes" | "no" }>(
    (c, a, w, onProgress) => c.reclaimStake(a.id, a.side, w, onProgress),
    {
      confirmed: { title: "Reclaim recorded", description: PAYS },
      finalized: { title: "Stake returned", description: "The transaction finalized and your stake was delivered." },
    },
    "Failed to reclaim the stake",
    (a) => a.id
  );
}

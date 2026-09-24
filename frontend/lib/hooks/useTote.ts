"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Tote from "../contracts/Tote";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import { useWallet } from "../genlayer/wallet";
import { success, error, configError } from "../utils/toast";
import type { Market } from "../contracts/types";

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
    staleTime: 2000,
    enabled: !!contract && !!marketId,
  });
}

export function useAllMarketIds() {
  const contract = useToteContract();

  return useQuery<string[], Error>({
    queryKey: ["marketIds"],
    queryFn: () => (contract ? contract.getAllMarketIds() : Promise.resolve([])),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract,
  });
}

export function useMarketList() {
  const contract = useToteContract();
  const idsQuery = useAllMarketIds();

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

export function useHasClaimed(marketId: string, wallet: string | null) {
  const contract = useToteContract();

  return useQuery<boolean, Error>({
    queryKey: ["hasClaimed", marketId, wallet],
    queryFn: () => (contract && wallet ? contract.hasClaimed(marketId, wallet) : Promise.resolve(false)),
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract && !!marketId && !!wallet,
  });
}

function useWriteAction<TArgs>(
  action: (contract: Tote, args: TArgs, feePreset: any, onSubmitted: (h: string) => void) => Promise<string>,
  successMessage: { title: string; description: string },
  errorTitle: string,
  getMarketId: (args: TArgs) => string
) {
  const contract = useToteContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (args: TArgs) => {
      if (!contract) throw new Error("Contract not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file.");
      if (!address) throw new Error("Wallet not connected. Please connect your wallet first.");
      setIsPending(true);
      setPendingTxHash(null);
      return action(contract, args, undefined, setPendingTxHash);
    },
    onSuccess: (_data, args) => {
      const marketId = getMarketId(args);
      queryClient.invalidateQueries({ queryKey: ["market", marketId] });
      queryClient.invalidateQueries({ queryKey: ["marketIds"] });
      queryClient.invalidateQueries({ queryKey: ["marketList"] });
      queryClient.invalidateQueries({ queryKey: ["hasClaimed", marketId] });
      setIsPending(false);
      success(successMessage.title, { description: successMessage.description });
    },
    onError: (err: any) => {
      console.error(errorTitle, err);
      setIsPending(false);
      error(errorTitle, { description: err?.message || "Please try again." });
    },
  });

  return {
    ...mutation,
    isPending,
    pendingTxHash,
    clearPendingTx: () => setPendingTxHash(null),
    run: mutation.mutate,
  };
}

export interface CreateMarketArgs {
  id: string;
  question: string;
  url: string;
  yesMarker: string;
  noMarker: string;
  lockTime: number;
  resolveAfter: number;
}

export function useCreateMarket() {
  return useWriteAction<CreateMarketArgs>(
    (c, a, fee, cb) => c.createMarket(a.id, a.question, a.url, a.yesMarker, a.noMarker, a.lockTime, a.resolveAfter, fee, cb),
    { title: "Market opened", description: "Staking is now live." },
    "Failed to create market",
    (a) => a.id
  );
}

export function useStake() {
  return useWriteAction<{ id: string; side: "yes" | "no"; amountWei: bigint }>(
    (c, a, fee, cb) => c.stake(a.id, a.side, a.amountWei, fee, cb),
    { title: "Staked", description: "Your position is live on-chain." },
    "Failed to stake",
    (a) => a.id
  );
}

export function useResolve() {
  return useWriteAction<{ id: string }>(
    (c, a, fee, cb) => c.resolve(a.id, fee, cb),
    { title: "Resolved", description: "Validators confirmed the outcome." },
    "Resolution failed",
    (a) => a.id
  );
}

export function useChallenge() {
  return useWriteAction<{ id: string; reason: string }>(
    (c, a, fee, cb) => c.challenge(a.id, a.reason, fee, cb),
    { title: "Challenge filed", description: "Escalated for reasoned review." },
    "Failed to challenge",
    (a) => a.id
  );
}

export function useResolveDispute() {
  return useWriteAction<{ id: string }>(
    (c, a, fee, cb) => c.resolveDispute(a.id, fee, cb),
    { title: "Dispute resolved", description: "Validators reached a verdict." },
    "Failed to resolve dispute",
    (a) => a.id
  );
}

export function useFinalize() {
  return useWriteAction<{ id: string }>(
    (c, a, fee, cb) => c.finalize(a.id, fee, cb),
    { title: "Finalized", description: "Claims are now open." },
    "Failed to finalize",
    (a) => a.id
  );
}

export function useClaim() {
  return useWriteAction<{ id: string }>(
    (c, a, fee, cb) => c.claim(a.id, fee, cb),
    { title: "Claimed", description: "Payout recorded." },
    "Failed to claim",
    (a) => a.id
  );
}

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
} from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Wallet, LogOut, ArrowRightLeft, Coins, Gem } from "lucide-react";

const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function ConnectWallet() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect({ mutation: { onSettled: () => setShowMenu(false) } });
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const {
    data: balance,
    isLoading: balanceLoading,
    isError: balanceError,
  } = useBalance({
    address,
    chainId: polygon.id,
  });
  const {
    data: usdcData,
    isLoading: usdcLoading,
    isError: usdcError,
  } = useReadContracts({
    contracts: [
      {
        address: USDC_E_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: polygon.id,
      },
      {
        address: USDC_E_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
        chainId: polygon.id,
      },
      {
        address: USDC_E_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
        chainId: polygon.id,
      },
    ],
    query: {
      enabled: !!address && chain?.id === 137,
    },
  });
  const [showMenu, setShowMenu] = useState(false);

  // Close menu on Escape key
  useEffect(() => {
    if (!showMenu) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMenu(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showMenu]);

  const usdcBalance = usdcData?.[0]?.result as bigint | undefined;
  const usdcDecimals = (usdcData?.[1]?.result as number | undefined) ?? 6;
  const usdcSymbol = (usdcData?.[2]?.result as string | undefined) ?? "USDC.e";
  const usdcFormatted =
    usdcBalance !== undefined
      ? (Number(usdcBalance) / 10 ** usdcDecimals).toFixed(2)
      : null;
  const inlineLoading = usdcLoading || balanceLoading;

  if (!isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-3 text-xs"
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
      >
        <Wallet className="size-3.5" /> {isPending ? "Connecting..." : "Connect Wallet"}
      </Button>
    );
  }

  if (isConnected && chain?.id !== 137) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-3 text-xs text-amber-400 border-amber-500/30"
        onClick={() => switchChain({ chainId: polygon.id })}
        disabled={isSwitching}
      >
        <ArrowRightLeft className="size-3.5" /> {isSwitching ? "Switching..." : "Switch to Polygon"}
      </Button>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <span
        className={cn(
          "text-xs font-mono",
          balanceError && usdcError ? "text-red-400" : "text-muted-foreground"
        )}
      >
        {inlineLoading
          ? "..."
          : usdcFormatted
            ? `${usdcFormatted} ${usdcSymbol}`
            : balance
              ? `${Number(formatUnits(balance.value, balance.decimals)).toFixed(2)} POL`
              : balanceError && usdcError
                ? "Err"
                : "--"}
      </span>
      <button
        type="button"
        onClick={() => setShowMenu((v) => !v)}
        className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-[44px] sm:min-h-0"
      >
        <span className="font-mono text-xs text-muted-foreground">
          {address ? truncateAddress(address) : ""}
        </span>
        <Badge
          variant="default"
          className={cn(
            "text-[11px]",
            chain?.id === 137
              ? "bg-purple-600 hover:bg-purple-600"
              : "bg-amber-600 hover:bg-amber-600"
          )}
        >
          {chain?.name ?? "Unknown"}
        </Badge>
      </button>
      {showMenu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setShowMenu(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div className="fixed sm:absolute bottom-0 sm:bottom-auto left-0 sm:left-auto right-0 sm:right-0 top-auto sm:top-full sm:mt-2 z-50 sm:min-w-[200px] rounded-t-xl sm:rounded-md border-t sm:border border-border bg-popover p-1 shadow-lg" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Wallet className="size-3" /> Address</div>
              <div className="font-mono text-xs break-all">{address}</div>
            </div>
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Coins className="size-3" /> USDC.e Balance</div>
              <div
                className={cn(
                  "font-mono text-xs",
                  usdcError ? "text-red-400" : "text-emerald-400"
                )}
              >
                {usdcLoading
                  ? "Loading..."
                  : usdcError
                    ? "Unavailable"
                    : usdcFormatted
                      ? `${usdcFormatted} ${usdcSymbol}`
                      : "0.00 USDC.e"}
              </div>
            </div>
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Gem className="size-3" /> Native Balance</div>
              <div className={cn("font-mono text-xs", balanceError ? "text-red-400" : "") }>
                {balanceLoading
                  ? "Loading..."
                  : balanceError
                    ? "Unavailable"
                    : balance
                      ? `${Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} POL`
                      : "0.0000 POL"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => disconnect()}
              className="w-full text-left px-3 py-3 sm:py-2 text-xs text-red-400 hover:bg-accent rounded-sm transition-colors min-h-[44px] sm:min-h-0 flex items-center"
            >
              <LogOut className="size-3" /> Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

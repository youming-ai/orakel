import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface TradeRecord {
  timestamp: string;
  market: string;
  side: string;
  amount: string;
  price: string;
  orderId: string;
  status: string;
}

interface TradeTableProps {
  trades: TradeRecord[];
  paperMode: boolean;
}

const PAGE_SIZE = 10;

function fmtTimestamp(ts: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function fmtDate(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}

function sideLabel(side: string): { text: string; isUp: boolean } {
  const up = (side ?? "").includes("UP");
  return { text: up ? "BUY UP" : "BUY DOWN", isUp: up };
}

export function TradeTable({ trades, paperMode }: TradeTableProps) {
  const [page, setPage] = useState(1);

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No trades yet
      </div>
    );
  }

  const totalPages = Math.ceil(trades.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageTrades = trades.slice(start, end);

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Date</TableHead>
              <TableHead className="w-20">Time</TableHead>
              <TableHead className="w-16">Market</TableHead>
              <TableHead className="w-24">Side</TableHead>
              <TableHead className="w-16 text-right">Amount</TableHead>
              <TableHead className="w-16 text-right">Price</TableHead>
              <TableHead className="w-24">Status</TableHead>
              {paperMode && <TableHead className="w-16">Mode</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageTrades.map((t, i) => {
              const { text, isUp } = sideLabel(t.side);
              return (
                <TableRow key={`${t.orderId}-${i}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{fmtDate(t.timestamp)}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtTimestamp(t.timestamp)}</TableCell>
                  <TableCell className="font-mono text-xs font-medium">{t.market}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5",
                        isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
                      )}
                    >
                      {text}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-right">{t.amount}</TableCell>
                  <TableCell className="font-mono text-xs text-right">{t.price}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {t.status || "placed"}
                    </Badge>
                  </TableCell>
                  {paperMode && (
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 bg-amber-500/15 text-amber-400 border-amber-500/30"
                      >
                        PAPER
                      </Badge>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {trades.length} total, page {page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

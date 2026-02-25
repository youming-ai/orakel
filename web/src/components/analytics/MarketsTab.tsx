import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartErrorBoundary } from "../ChartErrorBoundary";
import { EmptyPlaceholder } from "./OverviewTab";
import { CHART_COLORS, CHART_HEIGHT, TOOLTIP_CONTENT_STYLE } from "@/lib/charts";
import { asNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MarketsTabProps {
    marketRows: Array<{
        market: string;
        trades: number;
        wins: number;
        losses: number;
        pending: number;
        winRate: number;
        winRatePct: number;
        pnl: number;
        resolvedCount: number;
    }>;
}

export function MarketsTab({ marketRows }: MarketsTabProps) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                            Win Rate by Market
                        </CardTitle>
                    </CardHeader>
                    <CardContent className={CHART_HEIGHT.responsive}>
                        {marketRows.length === 0 ? (
                            <EmptyPlaceholder />
                        ) : (
                            <ChartErrorBoundary>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={marketRows}
                                        layout="vertical"
                                        margin={{ right: 56 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                                        <XAxis
                                            type="number"
                                            domain={[0, 100]}
                                            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                                        />
                                        <YAxis
                                            type="category"
                                            dataKey="market"
                                            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                                            width={48}
                                        />
                                        <Tooltip
                                            contentStyle={TOOLTIP_CONTENT_STYLE}
                                            formatter={(value, _, item) => {
                                                const v = asNumber(value, 0);
                                                const p = item.payload as {
                                                    wins: number;
                                                    resolvedCount: number;
                                                };
                                                return [
                                                    `${v.toFixed(1)}% (${p.wins}/${p.resolvedCount})`,
                                                    "Win Rate",
                                                ];
                                            }}
                                        />
                                        <Bar
                                            dataKey="winRatePct"
                                            radius={[4, 4, 4, 4]}
                                            label={(props) => {
                                                const idx = Number(props.index);
                                                const row = marketRows[idx];
                                                if (!row) return null;
                                                return (
                                                    <text
                                                        x={Number(props.x) + Number(props.width) + 8}
                                                        y={Number(props.y) + Number(props.height) / 2 + 4}
                                                        fill="var(--muted-foreground)"
                                                        fontSize={11}
                                                    >
                                                        {`${row.wins}/${row.resolvedCount}`}
                                                    </text>
                                                );
                                            }}
                                        >
                                            {marketRows.map((row) => (
                                                <Cell
                                                    key={row.market}
                                                    fill={
                                                        row.winRate >= 0.5
                                                            ? CHART_COLORS.positive
                                                            : CHART_COLORS.negative
                                                    }
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartErrorBoundary>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                            P&L by Market
                        </CardTitle>
                    </CardHeader>
                    <CardContent className={CHART_HEIGHT.responsive}>
                        {marketRows.length === 0 ? (
                            <EmptyPlaceholder />
                        ) : (
                            <ChartErrorBoundary>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={marketRows}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                                        <XAxis
                                            dataKey="market"
                                            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                                            width={52}
                                        />
                                        <Tooltip
                                            contentStyle={TOOLTIP_CONTENT_STYLE}
                                            formatter={(value) => {
                                                const v = asNumber(value, 0);
                                                return [
                                                    `${v >= 0 ? "+" : ""}${v.toFixed(2)} USDC`,
                                                    "Total P&L",
                                                ];
                                            }}
                                        />
                                        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                            {marketRows.map((row) => (
                                                <Cell
                                                    key={`${row.market}-pnl`}
                                                    fill={
                                                        row.pnl >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative
                                                    }
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </ChartErrorBoundary>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                        Market Comparison
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {marketRows.length === 0 ? (
                        <EmptyPlaceholder />
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Market</TableHead>
                                        <TableHead className="text-right hidden sm:table-cell">
                                            Trades
                                        </TableHead>
                                        <TableHead className="text-right hidden sm:table-cell">
                                            W
                                        </TableHead>
                                        <TableHead className="text-right hidden sm:table-cell">
                                            L
                                        </TableHead>
                                        <TableHead className="text-right">WR%</TableHead>
                                        <TableHead className="text-right">P&L</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {marketRows.map((row) => (
                                        <TableRow key={`table-${row.market}`}>
                                            <TableCell className="font-mono text-xs font-medium">
                                                {row.market}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-right hidden sm:table-cell">
                                                {row.trades}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-right text-emerald-400 hidden sm:table-cell">
                                                {row.wins}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-right text-red-400 hidden sm:table-cell">
                                                {row.losses}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-right">
                                                {row.winRatePct.toFixed(1)}%
                                            </TableCell>
                                            <TableCell
                                                className={cn(
                                                    "font-mono text-xs text-right",
                                                    row.pnl >= 0 ? "text-emerald-400" : "text-red-400",
                                                )}
                                            >
                                                {row.pnl >= 0 ? "+" : ""}
                                                {row.pnl.toFixed(2)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

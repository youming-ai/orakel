import { Save, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { asNumber } from "@/lib/format";
import type { RiskConfig, StrategyConfig } from "@/lib/api";

export interface StrategyFormValues {
    edgeThresholdEarly: number;
    edgeThresholdMid: number;
    edgeThresholdLate: number;
    minProbEarly: number;
    minProbMid: number;
    minProbLate: number;
    blendVol: number;
    blendTa: number;
    maxTradeSizeUsdc: number;
    maxOpenPositions: number;
    dailyMaxLossUsdc: number;
    regimeCHOP: number;
    regimeRANGE: number;
    regimeTREND_ALIGNED: number;
    regimeTREND_OPPOSED: number;
}

interface StrategyTabProps {
    strategyView: StrategyConfig;
    riskView: RiskConfig;
    form: StrategyFormValues;
    setForm: React.Dispatch<React.SetStateAction<StrategyFormValues>>;
    blendSum: number;
    blendValid: boolean;
    saveConfig: () => void;
    configMutation: {
        isPending: boolean;
        isSuccess: boolean;
    };
}

function ParamField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground block">{label}</span>
            {children}
        </div>
    );
}

function numberInput(
    value: number,
    onValue: (n: number) => void,
    step = 0.01,
    min = 0,
    max?: number,
) {
    return (
        <input
            type="number"
            className="h-8 w-full rounded-md border border-border bg-input/30 px-2 text-xs font-mono outline-none focus:border-emerald-400"
            value={Number.isFinite(value) ? value : 0}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
                const n = asNumber(e.target.value, 0);
                onValue(
                    max !== undefined
                        ? Math.min(max, Math.max(min, n))
                        : Math.max(min, n),
                );
            }}
        />
    );
}

export function StrategyTab({
    strategyView,
    riskView,
    form,
    setForm,
    blendSum,
    blendValid,
    saveConfig,
    configMutation,
}: StrategyTabProps) {
    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                        Current Strategy Config
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground block">
                                Edge Threshold
                            </span>
                            <div className="font-mono text-xs space-y-0.5">
                                <div>
                                    EARLY:{" "}
                                    <span className="text-emerald-400">
                                        {(strategyView.edgeThresholdEarly * 100).toFixed(1)}%
                                    </span>
                                </div>
                                <div>
                                    MID:{" "}
                                    <span className="text-amber-400">
                                        {(strategyView.edgeThresholdMid * 100).toFixed(1)}%
                                    </span>
                                </div>
                                <div>
                                    LATE:{" "}
                                    <span className="text-red-400">
                                        {(strategyView.edgeThresholdLate * 100).toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground block">
                                Min Probability
                            </span>
                            <div className="font-mono text-xs space-y-0.5">
                                <div>
                                    EARLY: {(strategyView.minProbEarly * 100).toFixed(1)}%
                                </div>
                                <div>MID: {(strategyView.minProbMid * 100).toFixed(1)}%</div>
                                <div>
                                    LATE: {(strategyView.minProbLate * 100).toFixed(1)}%
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground block">
                                Blend Weights
                            </span>
                            <div className="font-mono text-xs space-y-0.5">
                                <div>
                                    Volatility:{" "}
                                    {(strategyView.blendWeights.vol * 100).toFixed(1)}%
                                </div>
                                <div>
                                    Technical: {(strategyView.blendWeights.ta * 100).toFixed(1)}
                                    %
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground block">
                                Risk Config
                            </span>
                            <div className="font-mono text-xs space-y-0.5">
                                <div>Per Trade: ${riskView.maxTradeSizeUsdc}</div>
                                <div>Max Positions: {riskView.maxOpenPositions}</div>
                                <div>Daily Loss Limit: ${riskView.dailyMaxLossUsdc}</div>
                            </div>
                        </div>
                    </div>
                    <div className="pt-2 border-t border-border">
                        <span className="text-[11px] text-muted-foreground block mb-2">
                            Regime Multipliers
                        </span>
                        <div className="flex flex-wrap gap-3 font-mono text-xs">
                            <span>
                                CHOP:{" "}
                                <span className="text-amber-400">
                                    x{strategyView.regimeMultipliers.CHOP}
                                </span>
                            </span>
                            <span>
                                RANGE:{" "}
                                <span className="text-muted-foreground">
                                    x{strategyView.regimeMultipliers.RANGE}
                                </span>
                            </span>
                            <span>
                                ALIGNED:{" "}
                                <span className="text-emerald-400">
                                    x{strategyView.regimeMultipliers.TREND_ALIGNED}
                                </span>
                            </span>
                            <span>
                                OPPOSED:{" "}
                                <span className="text-red-400">
                                    x{strategyView.regimeMultipliers.TREND_OPPOSED}
                                </span>
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                        Strategy Tuning
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ParamField label="Edge EARLY">
                            {numberInput(form.edgeThresholdEarly, (v) =>
                                setForm((s) => ({ ...s, edgeThresholdEarly: v })),
                            )}
                        </ParamField>
                        <ParamField label="Edge MID">
                            {numberInput(form.edgeThresholdMid, (v) =>
                                setForm((s) => ({ ...s, edgeThresholdMid: v })),
                            )}
                        </ParamField>
                        <ParamField label="Edge LATE">
                            {numberInput(form.edgeThresholdLate, (v) =>
                                setForm((s) => ({ ...s, edgeThresholdLate: v })),
                            )}
                        </ParamField>
                        <ParamField label="MinProb EARLY">
                            {numberInput(form.minProbEarly, (v) =>
                                setForm((s) => ({ ...s, minProbEarly: v })),
                            )}
                        </ParamField>
                        <ParamField label="MinProb MID">
                            {numberInput(form.minProbMid, (v) =>
                                setForm((s) => ({ ...s, minProbMid: v })),
                            )}
                        </ParamField>
                        <ParamField label="MinProb LATE">
                            {numberInput(form.minProbLate, (v) =>
                                setForm((s) => ({ ...s, minProbLate: v })),
                            )}
                        </ParamField>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ParamField label="Blend Volatility">
                            {numberInput(
                                form.blendVol,
                                (v) => setForm((s) => ({ ...s, blendVol: v })),
                                0.01,
                                0,
                                1,
                            )}
                        </ParamField>
                        <ParamField label="Blend Technical">
                            {numberInput(
                                form.blendTa,
                                (v) => setForm((s) => ({ ...s, blendTa: v })),
                                0.01,
                                0,
                                1,
                            )}
                        </ParamField>
                        <div className="space-y-1">
                            <span className="text-[11px] text-muted-foreground block">
                                Weight Check
                            </span>
                            <div
                                className={cn(
                                    "h-8 rounded-md border px-2 flex items-center text-xs font-mono",
                                    blendValid
                                        ? "border-emerald-500/40 text-emerald-400"
                                        : "border-amber-500/40 text-amber-400",
                                )}
                            >
                                vol + ta = {blendSum.toFixed(3)}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ParamField label="Max Trade USDC">
                            {numberInput(
                                form.maxTradeSizeUsdc,
                                (v) => setForm((s) => ({ ...s, maxTradeSizeUsdc: v })),
                                0.1,
                                0,
                            )}
                        </ParamField>
                        <ParamField label="Max Positions">
                            {numberInput(
                                form.maxOpenPositions,
                                (v) => setForm((s) => ({ ...s, maxOpenPositions: v })),
                                1,
                                0,
                            )}
                        </ParamField>
                        <ParamField label="Daily Loss USDC">
                            {numberInput(
                                form.dailyMaxLossUsdc,
                                (v) => setForm((s) => ({ ...s, dailyMaxLossUsdc: v })),
                                0.1,
                                0,
                            )}
                        </ParamField>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <ParamField label="CHOP">
                            {numberInput(form.regimeCHOP, (v) =>
                                setForm((s) => ({ ...s, regimeCHOP: v })),
                            )}
                        </ParamField>
                        <ParamField label="RANGE">
                            {numberInput(form.regimeRANGE, (v) =>
                                setForm((s) => ({ ...s, regimeRANGE: v })),
                            )}
                        </ParamField>
                        <ParamField label="TREND_ALIGNED">
                            {numberInput(form.regimeTREND_ALIGNED, (v) =>
                                setForm((s) => ({ ...s, regimeTREND_ALIGNED: v })),
                            )}
                        </ParamField>
                        <ParamField label="TREND_OPPOSED">
                            {numberInput(form.regimeTREND_OPPOSED, (v) =>
                                setForm((s) => ({ ...s, regimeTREND_OPPOSED: v })),
                            )}
                        </ParamField>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                        <Button
                            size="sm"
                            className="w-full sm:w-auto h-8 min-w-[120px] transition-all group"
                            onClick={saveConfig}
                            disabled={configMutation.isPending || !blendValid}
                        >
                            {configMutation.isPending ? (
                                <span className="flex items-center gap-2">Saving...</span>
                            ) : configMutation.isSuccess ? (
                                <span className="flex items-center gap-2 text-emerald-400">
                                    Saved <Activity className="size-3.5 animate-in zoom-in" />
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 font-medium tracking-wide">
                                    <Save className="size-3.5 group-hover:-translate-y-0.5 transition-transform" />
                                    Save Config
                                </span>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

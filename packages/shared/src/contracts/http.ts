import type { z } from "zod";
import type {
	ControlRequestSchema,
	ControlResponseSchema,
	SignalRecordSchema,
	StatsDtoSchema,
	StatusDtoSchema,
	TradeRecordSchema,
} from "./schemas.ts";

export type TradeRecordDto = z.infer<typeof TradeRecordSchema>;
export type SignalRecordDto = z.infer<typeof SignalRecordSchema>;
export type StatsDto = z.infer<typeof StatsDtoSchema>;
export type StatusDto = z.infer<typeof StatusDtoSchema>;
export type ControlResponseDto = z.infer<typeof ControlResponseSchema>;
export type ControlRequestDto = z.infer<typeof ControlRequestSchema>;

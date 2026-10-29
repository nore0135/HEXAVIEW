import {z} from "zod";
export const credentials=z.object({email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(12).max(128)}).strict();
export const registration=credentials.extend({handle:z.string().regex(/^[a-z0-9_]{3,30}$/),displayName:z.string().trim().min(1).max(80)});
export const chartState=z.object({schemaVersion:z.literal(1),symbol:z.literal("BTCUSDT"),interval:z.enum(["1m","5m","15m","1h","4h","1d"]),showSma:z.boolean()}).strict();
export const workspace=z.object({name:z.string().trim().min(1).max(80),state:chartState}).strict();
export const updateWorkspace=workspace.extend({version:z.number().int().positive()});
export const uuid=z.string().uuid();

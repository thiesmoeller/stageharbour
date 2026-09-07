import { z } from 'zod';

/** Client heartbeat interval. The lease expires if three intervals elapse without a heartbeat. */
export const LEASE_HEARTBEAT_MS = 15_000;
export const LEASE_TTL_MS = 45_000;

export const leaseKindSchema = z.enum(['scene', 'venue', 'inventory']);
export type LeaseKind = z.infer<typeof leaseKindSchema>;
export const leaseHolderSchema = z.object({ holderUserId: z.string(), holderName: z.string() });
export type LeaseHolder = z.infer<typeof leaseHolderSchema>;

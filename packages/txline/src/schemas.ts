import { z } from "zod";

const byte = z.number().int().min(0).max(255);
export const hash32Schema = z.array(byte).length(32);

export const proofNodeSchema = z.object({
  hash: hash32Schema,
  isRightSibling: z.boolean(),
});

export const txLineV3ResponseSchema = z.object({
  ts: z.number().int().nonnegative(),
  summary: z.object({
    fixtureId: z.number().int().positive(),
    updateStats: z.object({
      updateCount: z.number().int().nonnegative(),
      minTimestamp: z.number().int().nonnegative(),
      maxTimestamp: z.number().int().nonnegative(),
    }),
    eventStatsSubTreeRoot: hash32Schema,
  }),
  eventStatRoot: hash32Schema,
  statsToProve: z.array(
    z.object({
      stat: z.object({
        key: z.number().int().nonnegative(),
        value: z.number().int(),
        period: z.number().int(),
      }),
      statProof: z.array(proofNodeSchema),
    }),
  ),
  multiproof: z.object({
    hashes: z.array(proofNodeSchema),
    indices: z.array(z.number().int().nonnegative()),
  }),
  subTreeProof: z.array(proofNodeSchema),
  mainTreeProof: z.array(proofNodeSchema),
});

export type TxLineV3Response = z.infer<typeof txLineV3ResponseSchema>;

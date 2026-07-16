import { PublicKey } from "@solana/web3.js";

export const POOL_SEED = "pool";
export const VAULT_SEED = "vault";
export const POSITION_SEED = "position";

function poolIdLe(poolId: bigint | number): Buffer {
  const id = BigInt(poolId);
  if (id < 0n || id > 0xffff_ffff_ffff_ffffn) throw new Error("poolId must fit u64");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(id);
  return bytes;
}

export function derivePoolPda(
  programId: PublicKey,
  creator: PublicKey,
  poolId: bigint | number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_SEED), creator.toBuffer(), poolIdLe(poolId)],
    programId,
  );
}

export function deriveVaultPda(programId: PublicKey, pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), pool.toBuffer()],
    programId,
  );
}

export function derivePositionPda(
  programId: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(POSITION_SEED), pool.toBuffer(), owner.toBuffer()],
    programId,
  );
}

import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Commitment, Connection, Keypair, PublicKey } from "@solana/web3.js";

const COMMITTED_IDL_URL = new URL(
  "../../../packages/stamp-sdk/src/idl/stamp.json",
  import.meta.url,
);

export function loadStampIdl(): Idl {
  return JSON.parse(fs.readFileSync(COMMITTED_IDL_URL, "utf8")) as Idl;
}

export function createStampProgram(options: {
  connection: Connection;
  expectedProgramId: PublicKey;
  payer?: Keypair;
  commitment?: Commitment;
}): Program {
  const commitment = options.commitment ?? "confirmed";
  const wallet = new Wallet(options.payer ?? Keypair.generate());
  const provider = new AnchorProvider(options.connection, wallet, {
    commitment,
    preflightCommitment: commitment,
  });
  const program = new Program(loadStampIdl(), provider);
  if (!program.programId.equals(options.expectedProgramId)) {
    throw new Error(
      `Committed IDL program ${program.programId.toBase58()} does not match configured STAMP program ${options.expectedProgramId.toBase58()}`,
    );
  }
  return program;
}

export function connectionFor(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

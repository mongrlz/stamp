import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import {
  STAMP_STAT_KEYS,
  TXLINE_DEVNET_PROGRAM_ID,
  TXLINE_FINAL_PERIOD,
} from "../packages/txline/src/constants.js";
import { TxLineClient } from "../packages/txline/src/client.js";
import { deriveDailyScoresRoot } from "../packages/txline/src/proof.js";

const IDL_URL = "https://raw.githubusercontent.com/txodds/tx-on-chain/main/idl/txoracle.json";

async function main(): Promise<void> {
  const [keypairPath, tokenPath, fixtureText = "18179550", sequenceText = "1315"] =
    process.argv.slice(2);
  if (!keypairPath || !tokenPath) {
    throw new Error(
      "Usage: npm run devnet:verify-txline -- <KEYPAIR_JSON> <TOKEN_JSON> [FIXTURE_ID] [SEQ]",
    );
  }
  const fixtureId = Number.parseInt(fixtureText, 10);
  const sequence = Number.parseInt(sequenceText, 10);
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
    base: string;
    jwt?: string;
    apiToken: unknown;
  };
  const txline = new TxLineClient({
    baseUrl: token.base,
    jwt: token.jwt,
    apiToken: typeof token.apiToken === "string" ? token.apiToken : JSON.stringify(token.apiToken),
  });
  const proof = await txline.stampProof(fixtureId, sequence);
  const idlResponse = await fetch(IDL_URL);
  if (!idlResponse.ok) throw new Error(`Official TxLINE IDL returned HTTP ${idlResponse.status}`);
  const idl = (await idlResponse.json()) as Idl & { address: string };
  idl.address = TXLINE_DEVNET_PROGRAM_ID;
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program(idl, provider);
  const oracleProgram = new PublicKey(TXLINE_DEVNET_PROGRAM_ID);
  const [dailyScoresRoots] = deriveDailyScoresRoot(oracleProgram, proof.ts);

  const payload = {
    ts: proof.ts,
    fixtureSummary: proof.fixtureSummary,
    fixtureProof: proof.fixtureProof,
    mainTreeProof: proof.mainTreeProof,
    eventStatRoot: proof.eventStatRoot,
    leaves: STAMP_STAT_KEYS.map((key, index) => ({
      stat: { key, value: proof.leafValues[index], period: TXLINE_FINAL_PERIOD },
      statProof: [],
    })),
    multiproofHashes: proof.multiproofHashes,
    leafIndices: proof.leafIndices,
  };
  const strategy = {
    geometricTargets: proof.leafValues.map((prediction, statIndex) => ({
      statIndex,
      prediction,
    })),
    distancePredicate: {
      threshold: 1,
      comparison: { lessThan: {} },
    },
    discretePredicates: [],
  };
  const method = (program.methods as unknown as {
    validateStatV3(payload: unknown, strategy: unknown): {
      accounts(value: { dailyScoresMerkleRoots: PublicKey }): {
        view(): Promise<boolean>;
        rpc(): Promise<string>;
      };
    };
  }).validateStatV3(payload, strategy).accounts({
    dailyScoresMerkleRoots: dailyScoresRoots,
  });
  const verified = await method.view();
  if (!verified) throw new Error("TxLINE accepted the proof but rejected the exact vector predicate");
  const signature = await method.rpc();

  process.stdout.write(`${JSON.stringify({
    idlVersion: (idl as unknown as { metadata?: { version?: string } }).metadata?.version,
    oracleProgram: oracleProgram.toBase58(),
    fixtureId,
    sequence,
    values: proof.leafValues,
    proofTimestamp: new BN(proof.ts).toString(),
    dailyScoresRoots: dailyScoresRoots.toBase58(),
    viewVerified: verified,
    signature,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

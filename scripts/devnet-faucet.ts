import fs from "node:fs";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const TXLINE_PROGRAM = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const DEVNET_USDT_MINT = new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");

async function main(): Promise<void> {
  const keypairPath = process.argv[2];
  if (!keypairPath) throw new Error("Usage: npm run devnet:faucet -- <KEYPAIR_JSON>");
  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync("../docs/txline-idl-devnet.json", "utf8")) as Idl;
  const program = new Program(idl, provider);
  if (!program.programId.equals(TXLINE_PROGRAM)) throw new Error("Local TxLINE devnet IDL has the wrong address");

  const [faucetTracker] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_tracker"), payer.publicKey.toBuffer()],
    TXLINE_PROGRAM,
  );
  const [usdtTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdt_treasury")],
    TXLINE_PROGRAM,
  );
  const userUsdtAta = getAssociatedTokenAddressSync(DEVNET_USDT_MINT, payer.publicKey);
  const signature = await (program.methods as unknown as {
    requestDevnetFaucet(): {
      accounts(value: Record<string, PublicKey>): { signers(value: Keypair[]): { rpc(): Promise<string> } };
    };
  }).requestDevnetFaucet().accounts({
    user: payer.publicKey,
    faucetTracker,
    usdtMint: DEVNET_USDT_MINT,
    userUsdtAta,
    usdtTreasuryPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).signers([payer]).rpc();

  process.stdout.write(`${JSON.stringify({
    signature,
    wallet: payer.publicKey.toBase58(),
    mint: DEVNET_USDT_MINT.toBase58(),
    tokenAccount: userUsdtAta.toBase58(),
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

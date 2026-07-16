#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"

if [[ ! -f target/deploy/local-test-wallet.json ]]; then
  mkdir -p target/deploy
  solana-keygen new \
    --no-bip39-passphrase \
    --silent \
    --force \
    --outfile target/deploy/local-test-wallet.json
fi

cleanup() {
  anchor build --program-name stamp
  npm run idl:sync
}
trap cleanup EXIT

anchor build --program-name mock_txline
anchor build --program-name stamp -- --features mock-oracle
npm run idl:sync
anchor test --skip-build --provider.wallet target/deploy/local-test-wallet.json

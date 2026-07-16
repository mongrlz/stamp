import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./styles.css";
import { StampWalletProvider } from "./wallet.js";

(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer ??= Buffer;

const root = document.getElementById("root");
if (!root) throw new Error("STAMP root element is missing");

createRoot(root).render(
  <StrictMode>
    <StampWalletProvider>
      <App />
    </StampWalletProvider>
  </StrictMode>,
);

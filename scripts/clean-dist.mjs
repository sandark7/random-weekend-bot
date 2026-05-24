import { rmSync } from "node:fs";

rmSync("dist-node", { recursive: true, force: true });

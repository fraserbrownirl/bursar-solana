import { readFileSync } from "node:fs";
import { firmwareCheck } from "../src/emulator.js";
import { checkMark } from "../src/model.js";

const tx = JSON.parse(readFileSync("docs/for-dispatcher.json", "utf8")).txs[0];
const hit = firmwareCheck(tx.hex, tx.payTo, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tx.amount, 6);
process.stdout.write(`${hit.cmd}\n${hit.result}\n${checkMark(hit)}\n`);

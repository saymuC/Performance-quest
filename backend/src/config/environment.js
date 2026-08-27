import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(backendDirectory, ".env"), quiet: true });
dotenv.config({ path: path.resolve(backendDirectory, "../.env"), quiet: true });

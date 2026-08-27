import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync(new URL("./node_modules/express/package.json", import.meta.url))) {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    console.log("Dependências não encontradas. Instalando o backend...");
    const result = spawnSync(npm, ["ci", "--omit=dev"], {
        cwd: new URL(".", import.meta.url),
        stdio: "inherit"
    });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

const { startServer } = await import("./index.js");
startServer();

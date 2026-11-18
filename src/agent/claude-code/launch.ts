import { spawn } from "node:child_process";
import { getClaudeBinary } from "./binary.ts";
import { inspectClaudeInstallation, readClaudeVersion, type ReadClaudeVersion } from "./installation.ts";
import type { RunClaude } from "./stream.ts";

export class ClaudeLaunchError extends Error {}

/** Injectable seams keep all verification offline; production uses the installed CLI. */
export function createClaudeLauncher({
	findBinary = getClaudeBinary,
	readVersion = readClaudeVersion,
	spawnProcess = spawn,
}: {
	findBinary?: () => string | null;
	readVersion?: ReadClaudeVersion;
	spawnProcess?: typeof spawn;
} = {}): RunClaude {
	return async (args, options) => {
		if (options.signal?.aborted) throw new ClaudeLaunchError("Request was aborted");
		const binary = findBinary();
		if (!binary) return null;
		const status = await inspectClaudeInstallation(() => binary, readVersion);
		if (status.state === "update-required") {
			throw new ClaudeLaunchError(`Claude Code ${status.version} må oppdateres. Eksamenshjelp krever minst ${status.minimumVersion}. Oppdater Claude Code utenfor Eksamenshjelp.`);
		}
		if (status.state !== "meets-minimum") {
			throw new ClaudeLaunchError("Kunne ikke sjekke versjonen av Claude Code. Sjekk installasjonen utenfor Eksamenshjelp og prøv igjen.");
		}
		if (options.signal?.aborted) throw new ClaudeLaunchError("Request was aborted");
		return spawnProcess(binary, args, { cwd: options.cwd, env: options.env, stdio: "pipe" });
	};
}

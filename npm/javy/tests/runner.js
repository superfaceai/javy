import { spawn } from "node:child_process";
import * as stream from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	ReadableStream,
	TextDecoderStream,
	TextEncoderStream,
} from "node:stream/web";
import { unlink } from "node:fs/promises";

import * as tests from "./tests.js";

const javyPath = new URL("../../../target/release/javy", import.meta.url)
	.pathname;

async function main() {
	console.log("Running tests...");
	const resultPromises = Object.entries(tests).map(([testName, testFunc]) =>
		Promise.resolve(testFunc())
			.then((value) => ({ testName, success: true, value }))
			.catch((value) => ({ testName, success: false, value }))
	);
	const results = await Promise.all(resultPromises);

	for (const { testName, success, value } of results) {
		const marker = success ? "PASS" : "FAIL";
		console.log(`[${marker}] ${testName}${success ? "" : `: ${value}`}`);
	}
}
await main();

export function stringAsInputStream(str) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(str);
			controller.close();
		},
	}).pipeThrough(new TextEncoderStream());
}

export async function runJS({ source, stdin, expectedOutput }) {
	const uuid = randomUUID();
	const outfile = join(tmpdir(), `${uuid}.wasm`);
	const infile = new URL(source, import.meta.url).pathname;
	await compileWithJavy(infile, outfile);
	const { exitCode, stdout, stderr } = await runCommand(
		"wasmtime",
		[outfile],
		stdin
	);
	if ((await exitCode) != 0) {
		throw Error(await collectStream(stderr));
	}
	const output = await collectStream(stdout);
	if (output != expectedOutput) {
		throw Error(`Unexpected output\n${output}`);
	}
	await unlink(outfile);
}

async function compileWithJavy(infile, outfile) {
	const { exitCode, stdout, stderr } = await runCommand(javyPath, [
		"-o",
		outfile,
		infile,
	]);
	if ((await exitCode) != 0) {
		throw Error(await collectStream(stderr));
	}
}
/**
 * @param {ReadableStream} stdin
 */
async function runCommand(cmd, args, stdin = emptyStream()) {
	const process = spawn(cmd, args, {
		stdio: "pipe",
	});
	stdin.pipeTo(stream.Writable.toWeb(process.stdin));

	const exitCode = new Promise((resolve) => {
		process.on("exit", (code) => resolve(code));
	});

	return {
		exitCode,
		stdout: stream.Readable.toWeb(process.stdout),
		stderr: stream.Readable.toWeb(process.stderr),
	};
}

/**
 * @param {ReadableStream} stream
 */

async function collectStream(stream) {
	const items = [];
	const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
	while (true) {
		const { value, done } = await reader.read();
		if (done) return items.join("");
		items.push(value);
	}
}
function emptyStream() {
	return new ReadableStream({
		start(controller) {
			controller.close();
		},
	});
}

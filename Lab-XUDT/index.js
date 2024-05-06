"use strict";

import fs from "fs";
import {utils} from "@ckb-lumos/base";
const {ckbHash, computeScriptHash, generateTypeIdScript} = utils;
import {initializeConfig} from "@ckb-lumos/config-manager";
import {addressToScript, TransactionSkeleton} from "@ckb-lumos/helpers";
import {CellCollector, Indexer} from "@ckb-lumos/ckb-indexer";
import {addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity, indexerReady, readFileToHexString, readFileToHexStringSync, sendTransaction, signTransaction, waitForTransactionConfirmation} from "../lib/index.js";
import {ckbytesToShannons, hexToArrayBuffer, hexToInt, intToHex, intToU128LeHexBytes, intToU4LeHexBytes, intToU32LeHexBytes, u128LeHexBytesToInt} from "../lib/util.js";
import {describeTransaction, initializeLab, validateLab} from "./lab.js";
import { types } from "util";
import pkg from '@nervosnetwork/ckb-sdk-utils';
import { blockchain } from "@ckb-lumos/base";
import { molecule, bytes } from "@ckb-lumos/codec";

const { scriptToAddress } = pkg;
const CONFIG = JSON.parse(fs.readFileSync("../config.json"));

// CKB Node and CKB Indexer Node JSON RPC URLs.
const NODE_URL = "http://127.0.0.1:8114/";
const INDEXER_URL = "http://127.0.0.1:8114/";


/* note on the role of each account
BOB: deployer of hardcap cell, xudt-rce and extension cells; Token receiver
Alice: token owner/issuer
Daniel: token transfer
*/

// These are the private keys and addresses that will be used in this exercise.
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";
const BOB_PRIVATE_KEY = "0x5e3bcd5a3c082c9eb1559930417710a39c5249b31090d88de2a2855149d0d981";
const BOB_ADDRESS = "ckt1qyq9gstman8qyjv0ucwqnw0h6z5cn6z9xxlssmqc92";
const CHARLIE_PRIVATE_KEY = "0xdb159ba4ba1ec8abdb7e9f570c7a1a1febf05eeb3f5d6ebdd50ee3bde7740189";
const CHARLIE_ADDRESS = "ckt1qyq9sz6wanl8v3tdmq6as38yq3j9hwg637kqu3e2xn";
const DANIEL_PRIVATE_KEY = "0x67842f5e4fa0edb34c9b4adbe8c3c1f3c737941f7c875d18bc6ec2f80554111d";
const DANIEL_ADDRESS = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvc32wruaxqnk4hdj8yr4yp5u056dkhwtc94sy8q";

// the binary of xudt script
const XUDT_RCE = "/Users/tung/Work/NERVOS/ckb-production-scripts/build/xudt_rce";
const XUDT_RCE_HASH = ckbHash(hexToArrayBuffer(readFileToHexStringSync(XUDT_RCE).hexString));
console.log(">>>XUDT_RCE_HASH: ", XUDT_RCE_HASH);

// the binary of extension script
const X_SCRIPT = "/Users/tung/Work/NERVOS/ckb-production-scripts/build/hard_cap.so";
const X_SCRIPT_HASH = ckbHash(hexToArrayBuffer(readFileToHexStringSync(X_SCRIPT).hexString));
console.log(">>>X_SCRIPT_HASH: ", X_SCRIPT_HASH);

const TX_FEE = 100_000n; // This is the TX fee amount that will be paid in Shannons.
const XUDT_FLAG = 1; // the XUDT FLAG. 1 means enable extension scripts
const TOTAL_SUPPLY = 21_000_000n; // total supply hardcap


/*Bob deploys 3 code cells:
	- xudt code cell
	- extension code cell
	- hardcap cell typeID
*/
async function deployCode(indexer)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell dep for the lock script.
	transaction = addDefaultCellDeps(transaction);

	// fetch binaries and estimate binary size
	const {hexString: hexString1, dataSize: dataSize1} = await readFileToHexString(XUDT_RCE);
	const xudtrce_capacity = ckbytesToShannons(61n) + ckbytesToShannons(dataSize1);
	const {hexString: hexString2, dataSize: dataSize2} = await readFileToHexString(X_SCRIPT);
	const extension_script_capacity = ckbytesToShannons(61n) + ckbytesToShannons(dataSize2);

	// a typeID cell capacity that serves as a hardcap cell
	const typeIDCapacity = ckbytesToShannons(8n + 32n + 1n + 20n + 32n + 1n + 32n + 4n/*4 bytes to store the hardcap in data field*/);

	// calculate output typeID cell first
	const requiredCapacity = typeIDCapacity + xudtrce_capacity + extension_script_capacity + ckbytesToShannons(61n) + TX_FEE;

	// Add input capacity cells.
	const collectedCells = await collectCapacity(indexer, addressToScript(BOB_ADDRESS), requiredCapacity);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));
	const firstInput = collectedCells.inputCells[0];

	// Creating typeID for the hardcap cell
	// output index of the type id is #0
	const hardCapTypeId = generateTypeIdScript({previousOutput: firstInput.outPoint, since: "0x0"}, "0x0");
	
	// Placing outputs
	const output = {cellOutput: {capacity: intToHex(typeIDCapacity), lock: addressToScript(BOB_ADDRESS), type: hardCapTypeId}, data: intToU4LeHexBytes(TOTAL_SUPPLY)};
	transaction = transaction.update("outputs", (i)=>i.push(output));
	const output1 = {cellOutput: {capacity: intToHex(xudtrce_capacity), lock: addressToScript(BOB_ADDRESS), type: null}, data: hexString1};
	transaction = transaction.update("outputs", (i)=>i.push(output1));
	const output2 = {cellOutput: {capacity: intToHex(extension_script_capacity), lock: addressToScript(BOB_ADDRESS), type: null}, data: hexString2};
	transaction = transaction.update("outputs", (i)=>i.push(output2));

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes. Since requiredCapacity has added 61, change cell will be greater than 61ckb
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	let change = {cellOutput: {capacity: changeCapacity, lock: addressToScript(BOB_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	// await validateLab(transaction, "deploy");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, BOB_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");

	// Return the out point for the binaries so it can be used in the next transaction.
	return {
		cellDeps : [
			{
				txHash: txid,
				index: "0x0"
			},
			{
				txHash: txid,
				index: "0x1"
			},
			{
				txHash: txid,
				index: "0x2"
			},
		],
		hardCapTypeId: hardCapTypeId
	};
}

async function calculateSmartcontractInfo(ownerAddress, hardcapTypeId) {
	// Create a token cells.
	const lockScriptHashAlice = computeScriptHash(addressToScript(ownerAddress));

	// serialize hardcap cell type id to put it in xargs
	const Script = blockchain.Script;
	const serializedHardcapTypeID = bytes.hexify(Script.pack(hardcapTypeId));

	// serializing xudt's script vec
	const hash_type = "data1";
	const ScriptVec = molecule.vector(blockchain.Script);
	const serializedXdata = bytes.hexify(ScriptVec.pack([{codeHash: X_SCRIPT_HASH, hashType: hash_type, args: serializedHardcapTypeID}]));

	// 0x1 - using extension script
	const xudtFlag = intToU32LeHexBytes(XUDT_FLAG);
	const args = lockScriptHashAlice + xudtFlag.substr(2) + serializedXdata.substr(2);
	const argsSize = args.length;

	const outputCapacity = intToHex(ckbytesToShannons(8n + 32n + 1n + 20n + 32n + 1n + BigInt(argsSize) + 16n + 4n));

	const typeScript = {
		codeHash: XUDT_RCE_HASH,
		hashType: "data1",
		args: args
	};

	return {
		cellCapacity: outputCapacity,
		typeScript: typeScript
	};
}

async function createCells(indexer, cell_deps, cellOutputCapacity, typeScript)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	let cellDep = {depType: "code", outPoint: cell_deps[0]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));
	cellDep = {depType: "code", outPoint: cell_deps[1]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));
	cellDep = {depType: "code", outPoint: cell_deps[2]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	const first4cellsAmmount = [[ALICE_ADDRESS, 100], [ALICE_ADDRESS, 300], [ALICE_ADDRESS, 700], [DANIEL_ADDRESS, 900]];
	for (const pair of first4cellsAmmount) {
		const sudtData = intToU128LeHexBytes(pair[1]);
		const outputx = {cellOutput: {capacity: cellOutputCapacity, lock: addressToScript(pair[0]), type: typeScript}, data: sudtData};
		transaction = transaction.update("outputs", (o)=>o.push(outputx));
	}
	
	// Determine the capacity from all output Cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	
	// Add input capacity cells.
	const capacityRequired = outputCapacity + TX_FEE + 61n/*adding 61n for the change cell*/;
	const cellCollection = await collectCapacity(indexer, addressToScript(ALICE_ADDRESS), capacityRequired)
	transaction = transaction.update("inputs", (i)=>i.concat(cellCollection.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	const changeCell = {cellOutput: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (c)=>c.push(changeCell));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	// await validateLab(transaction, "create");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

async function transferCells(indexer, cell_deps, cellOutputCapacity, typeScript)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	let cellDep = {depType: "code", outPoint: cell_deps[0]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));
	cellDep = {depType: "code", outPoint: cell_deps[1]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));
	cellDep = {depType: "code", outPoint: cell_deps[2]};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	const query = {lock: addressToScript(DANIEL_ADDRESS), type: typeScript};
	const cellCollection = new CellCollector(indexer, query);
	for await (const cell of cellCollection.collect())
		transaction = transaction.update("inputs", (i)=>i.push(cell));

	// Add output token cells.
	const receiverList = [[BOB_ADDRESS, 200], [CHARLIE_ADDRESS, 500]];
	for (const receiver of receiverList) {
		const datax = intToU128LeHexBytes(receiver[1]);
		const output = {cellOutput: {capacity: cellOutputCapacity, lock: addressToScript(receiver[0]), type: typeScript}, data: datax};
		transaction = transaction.update("outputs", (o)=>o.push(output));
	}

	// Determine the tokens from all input cells.
	const inputTokens = transaction.inputs.toArray().reduce((a, c)=>a+u128LeHexBytesToInt(c.data), 0n);
	const outputTokens = transaction.outputs.toArray().reduce((a, c)=>a+u128LeHexBytesToInt(c.data), 0n);

	// Create a token change cell.
	const changeSUDT = intToU128LeHexBytes(inputTokens - outputTokens);
	const tokenchangeCell = {cellOutput: {capacity: cellOutputCapacity, lock: addressToScript(DANIEL_ADDRESS), type: typeScript}, data: changeSUDT};
	transaction = transaction.update("outputs", (o)=>o.push(tokenchangeCell));

	// Determine the capacity for the output cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Add input capacity cells.
	const capacityRequired = intToHex(outputCapacity + TX_FEE + ckbytesToShannons(61n));
	const cellCollection1 = await collectCapacity(indexer, addressToScript(DANIEL_ADDRESS), capacityRequired);
	transaction = transaction.update("inputs", (o)=>o.concat(cellCollection1.inputCells));

	// Determine the capacity from input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	const changeCell = {cellOutput: {capacity: changeCapacity, lock: addressToScript(DANIEL_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (o)=>o.push(changeCell));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	// await validateLab(transaction, "transfer");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, DANIEL_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

async function consumeCells(indexer, extensionScriptCodeOutpoint, xudtScriptCodeOutPoint)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	let cellDep = {depType: "code", outPoint: extensionScriptCodeOutpoint};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));
	cellDep = {depType: "code", outPoint: xudtScriptCodeOutPoint};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	// Add Alice's token cells to the transaction.
	const lockScriptHashAlice = computeScriptHash(addressToScript(ALICE_ADDRESS));
	const typeScript = {
		codeHash: XUDT_RCE_HASH,
		hashType: "data1",
		args: lockScriptHashAlice
	};
	const query = {lock: addressToScript(ALICE_ADDRESS), type: typeScript};
	const collectedCells = new CellCollector(indexer, query);
	for await (const cell of collectedCells.collect()) {
		// TODO - change the type script to see how typeScript govern data in the blockchain.
		// console.log(">>>cell: ", cell)
		transaction = transaction.update("inputs", (i)=>i.push(cell));
	}

	// Determine the capacity of the input and output cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n); //0
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	const changeCell = {cellOutput: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (o)=>o.push(changeCell));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	// await validateLab(transaction, "consume");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

// Alice transfer Daniel some coins
async function AliceSharesCKB(indexer) {
	let transaction = TransactionSkeleton();
	transaction = addDefaultCellDeps(transaction);

	// calculate output typeID cell first
	let requiredCapacity = ckbytesToShannons(60_000n);

	// Add input capacity cells.
	const collectedCells = await collectCapacity(indexer, addressToScript(ALICE_ADDRESS), requiredCapacity + ckbytesToShannons(61n) + TX_FEE);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));
	const firstInput = collectedCells.inputCells[0];

	// add output
	const output = {cellOutput: {capacity: intToHex(ckbytesToShannons(10_000n)), lock: addressToScript(DANIEL_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(output));
	const output1 = {cellOutput: {capacity: intToHex(ckbytesToShannons(50_000n)), lock: addressToScript(BOB_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(output1));

	// Determine the capacity of the input and output cells.
	let outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n); //0
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	const changeCell = {cellOutput: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (o)=>o.push(changeCell));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	// await validateLab(transaction, "consume");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

async function main()
{
	// Initialize the Lumos configuration using ./config.json.
	initializeConfig(CONFIG);

	// Initialize an Indexer instance.
	const indexer = new Indexer(INDEXER_URL, NODE_URL);

	// Initialize our lab.
	await initializeLab(NODE_URL, indexer);
	await indexerReady(indexer);

	console.log("[### Alice shares CKB");
	await AliceSharesCKB(indexer);
	await indexerReady(indexer);

	console.log("[### Bob deploys data and code cells");
	const {cellDeps: cell_deps, hardCapTypeId: hardCapTypeId} = await deployCode(indexer);
	await indexerReady(indexer);

	/* calculate smart contract info
	 - cellCapacity: each cell with this certain type of tokens will require how many ckb?
	 - typeScript: those cells attached with this typescript, will belong to a contract
	*/
	const {cellCapacity: cellOutputCapacity, typeScript: typeScript} = await calculateSmartcontractInfo(ALICE_ADDRESS, hardCapTypeId);

	// Create cells that uses the binary that was just deployed.
	console.log("[### Alice create cells");
	await createCells(indexer, cell_deps, cellOutputCapacity, typeScript);
	await indexerReady(indexer);

	// Transfer the cells created in the last transaction.
	console.log("[### transfer cells");
	await transferCells(indexer, cell_deps, cellOutputCapacity, typeScript);
	await indexerReady(indexer);

	// // Burn token cells created in the last transaction.
	// console.log("### consume cells");
	// await consumeCells(indexer, extensionScriptCodeOutpoint, xudtScriptCodeOutPoint);
	// await indexerReady(indexer);

	console.log("Exercise completed successfully!");
}
main();

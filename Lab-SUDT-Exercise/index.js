"use strict";

import fs from "fs";
import {utils} from "@ckb-lumos/base";
const {ckbHash, computeScriptHash} = utils;
import {initializeConfig} from "@ckb-lumos/config-manager";
import {addressToScript, TransactionSkeleton} from "@ckb-lumos/helpers";
import {CellCollector, Indexer} from "@ckb-lumos/ckb-indexer";
import {addDefaultCellDeps, addDefaultWitnessPlaceholders, collectCapacity, indexerReady, readFileToHexString, readFileToHexStringSync, sendTransaction, signTransaction, waitForTransactionConfirmation} from "../lib/index.js";
import {ckbytesToShannons, hexToArrayBuffer, hexToInt, intToHex, intToU128LeHexBytes, u128LeHexBytesToInt} from "../lib/util.js";
import {describeTransaction, initializeLab, validateLab} from "./lab.js";
const CONFIG = JSON.parse(fs.readFileSync("../config.json"));

// CKB Node and CKB Indexer Node JSON RPC URLs.
const NODE_URL = "http://127.0.0.1:8114/";
const INDEXER_URL = "http://127.0.0.1:8114/";

// These are the private keys and addresses that will be used in this exercise.
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";
const BOB_ADDRESS = "ckt1qyq9gstman8qyjv0ucwqnw0h6z5cn6z9xxlssmqc92";
const CHARLIE_ADDRESS = "ckt1qyq9sz6wanl8v3tdmq6as38yq3j9hwg637kqu3e2xn";
const DANIEL_ADDRESS = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvc32wruaxqnk4hdj8yr4yp5u056dkhwtc94sy8q";

// This is the RISC-V binary.
const DATA_FILE_1 = "../files/sudt";
const DATA_FILE_HASH_1 = ckbHash(hexToArrayBuffer(readFileToHexStringSync(DATA_FILE_1).hexString)); // Blake2b hash of the RISC-V binary.

// This is the TX fee amount that will be paid in Shannons.
const TX_FEE = 100_000n;

async function deployCode(indexer)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell dep for the lock script.
	transaction = addDefaultCellDeps(transaction);

	// Create a cell with data from the specified file.
	const {hexString: hexString1, dataSize: dataSize1} = await readFileToHexString(DATA_FILE_1);
	const outputCapacity1 = ckbytesToShannons(61n) + ckbytesToShannons(dataSize1);
	const output1 = {cellOutput: {capacity: intToHex(outputCapacity1), lock: addressToScript(ALICE_ADDRESS), type: null}, data: hexString1};
	transaction = transaction.update("outputs", (i)=>i.push(output1));

	// Add input capacity cells.
	const collectedCells = await collectCapacity(indexer, addressToScript(ALICE_ADDRESS), outputCapacity1 + ckbytesToShannons(61n) + TX_FEE);
	transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	let change = {cellOutput: {capacity: changeCapacity, lock: addressToScript(ALICE_ADDRESS), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	await validateLab(transaction, "deploy");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");

	// Return the out point for the binary so it can be used in the next transaction.
	const outPoint =
	{
		txHash: txid,
		index: "0x0"
	};

	return outPoint;
}

async function createCells(indexer, scriptCodeOutPoint)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	const cellDep = {depType: "code", outPoint: scriptCodeOutPoint};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	// Create a token cells.
	???
	
	// Determine the capacity from all output Cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	
	// Add input capacity cells.
	???

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	???

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	await validateLab(transaction, "create");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

async function transferCells(indexer, scriptCodeOutPoint)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	const cellDep = {depType: "code", outPoint: scriptCodeOutPoint};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	// Add Alice's token cells to the transaction.
	???

	// Add output token cells.
	???

	// Determine the tokens from all input cells.
	const inputTokens = transaction.inputs.toArray().reduce((a, c)=>a+u128LeHexBytesToInt(c.data), 0n);
	const outputTokens = transaction.outputs.toArray().reduce((a, c)=>a+u128LeHexBytesToInt(c.data), 0n);

	// Create a token change cell.
	???

	// Determine the capacity for the output cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Add input capacity cells.
	???

	// Determine the capacity from input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	???

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	await validateLab(transaction, "transfer");

	// Sign the transaction.
	const signedTx = signTransaction(transaction, ALICE_PRIVATE_KEY);

	// Send the transaction to the RPC node.
	const txid = await sendTransaction(NODE_URL, signedTx);
	console.log(`Transaction Sent: ${txid}\n`);

	// Wait for the transaction to confirm.
	await waitForTransactionConfirmation(NODE_URL, txid);
	console.log("\n");
}

async function consumeCells(indexer, scriptCodeOutPoint)
{
	// Create a transaction skeleton.
	let transaction = TransactionSkeleton();

	// Add the cell deps.
	transaction = addDefaultCellDeps(transaction);
	const cellDep = {depType: "code", outPoint: scriptCodeOutPoint};
	transaction = transaction.update("cellDeps", (cellDeps)=>cellDeps.push(cellDep));

	// Add Alice's token cells to the transaction.
	???

	// Determine the capacity of the input and output cells.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	???

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Validate the transaction against the lab requirements.
	await validateLab(transaction, "consume");

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

	// Create a cell that contains the script code binary.
	const scriptCodeOutPoint = await deployCode(indexer);
	await indexerReady(indexer);

	// Create cells that uses the binary that was just deployed.
	await createCells(indexer, scriptCodeOutPoint);
	await indexerReady(indexer);

	// Transfer the cells created in the last transaction.
	await transferCells(indexer, scriptCodeOutPoint);
	await indexerReady(indexer);

	// Burn token cells created in the last transaction.
	await consumeCells(indexer, scriptCodeOutPoint);
	await indexerReady(indexer);

	console.log("Exercise completed successfully!");
}
main();

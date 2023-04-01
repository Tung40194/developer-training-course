"use strict";

import {addressToScript} from "@ckb-lumos/helpers";
import {locateCellDep, TransactionSkeleton} from "@ckb-lumos/helpers";
import {CellCollector} from "@ckb-lumos/ckb-indexer";
import {secp256k1Blake160} from "@ckb-lumos/common-scripts";
import {sealTransaction} from "@ckb-lumos/helpers";
import {addDefaultWitnessPlaceholders, collectCapacity, describeTransaction as libDescribeTransaction, getLiveCell, indexerReady, sendTransaction, signMessage, waitForConfirmation, DEFAULT_LOCK_HASH} from "../lib/index.js";
import {ckbytesToShannons, hexToInt, intToHex} from "../lib/util.js";
import isEqual from "lodash";

// These are the private keys and accounts to use with this lab.
const ALICE_PRIVATE_KEY = "0x81dabf8f74553c07999e1400a8ecc4abc44ef81c9466e6037bd36e4ad1631c17";
const ALICE_ADDRESS = "ckt1qyq2a6ymy7fjntsc2q0jajnmljt690g4xpdsyw4k5f";
const BOB_PRIVATE_KEY = "0x5e3bcd5a3c082c9eb1559930417710a39c5249b31090d88de2a2855149d0d981";
const BOB_ADDRESS = "ckt1qyq9gstman8qyjv0ucwqnw0h6z5cn6z9xxlssmqc92";
const CHARLIE_PRIVATE_KEY = "0xdb159ba4ba1ec8abdb7e9f570c7a1a1febf05eeb3f5d6ebdd50ee3bde7740189";
const CHARLIE_ADDRESS = "ckt1qyq9sz6wanl8v3tdmq6as38yq3j9hwg637kqu3e2xn";
const DANIEL_PRIVATE_KEY = "0x67842f5e4fa0edb34c9b4adbe8c3c1f3c737941f7c875d18bc6ec2f80554111d";
const DANIEL_ADDRESS = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvc32wruaxqnk4hdj8yr4yp5u056dkhwtc94sy8q";

// Genesis account used for funding.
const GENESIS_PRIVATE_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";
const GENESIS_ADDRESS = "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqwgx292hnvmn68xf779vmzrshpmm6epn4c0cgwga";	

export function describeTransaction(transaction)
{
	const options =
	{
		showCellDeps: false,
		showInputs: true,
		showInputType: false,
		showInputData: true,
		showOutputs: true,
		showOutputType: false,
		showOutputData: true,
		showWitnesses: false
	};

	return libDescribeTransaction(transaction, options);
}

export async function initializeLab(NODE_URL, indexer)
{
	// Genesis account.
	const fundingAccountPrivateKey = GENESIS_PRIVATE_KEY;
	const fundingAccountAddress = GENESIS_ADDRESS;	

	// Accounts to recycle any existing cells.
	const accountsToRecycle = [{address: ALICE_ADDRESS, PRIVATE_KEY: ALICE_PRIVATE_KEY}, {address: BOB_ADDRESS, PRIVATE_KEY: BOB_PRIVATE_KEY}, {address: CHARLIE_ADDRESS, PRIVATE_KEY: CHARLIE_PRIVATE_KEY}, {address: DANIEL_ADDRESS, PRIVATE_KEY: DANIEL_PRIVATE_KEY}];

	// Accounts to fund.
	const accountsToFund = [{address: ALICE_ADDRESS, PRIVATE_KEY: ALICE_PRIVATE_KEY}, {address: BOB_ADDRESS, PRIVATE_KEY: BOB_PRIVATE_KEY}, {address: CHARLIE_ADDRESS, PRIVATE_KEY: CHARLIE_PRIVATE_KEY}];
	const amountToFund = ckbytesToShannons(100n);

	// Transaction Fee
	const TX_FEE = 100_000n;

	// Initialize a Lumos instance.
	let transaction = await initializeLumosSkeleton(indexer);

	// Track which addresses were used during cell recycling.
	const addressesUsed = new Set();
	let totalRecycledCapacity = 0n;

	// Cycle through recycle addresses.
	for (const [addressIndex, account] of accountsToRecycle.entries())
	{
		// Recycle all existing cells to inputs.
		const query = {lock: addressToScript(account.address), type: null};
		const cellCollector = new CellCollector(indexer, query);
		const recycleCells = [];
		for await (const cell of cellCollector.collect())
			recycleCells.push(cell);
		if(recycleCells.length > 0)
			addressesUsed.add(addressIndex+1);
		transaction = transaction.update("inputs", (i)=>i.concat(recycleCells));

		// Determine the capacity from recycled Cells.
		const recycledCapacity = recycleCells.reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
		totalRecycledCapacity += recycledCapacity;
	}	

	// Create cells for the funding address.
	for (const account of accountsToFund)
	{
		const outputCapacity = intToHex(amountToFund);
		const output = {cellOutput: {capacity: outputCapacity, lock: addressToScript(account.address), type: null}, data: "0x"};
		transaction = transaction.update("outputs", (i)=>i.push(output));
	}

	// Get the sum of the outputs.
	const outputCapacity = transaction.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Add input capacity cells to the transaction.
	if(outputCapacity - totalRecycledCapacity + ckbytesToShannons(61n) > 0) // Only add if there isn't enough recycled capacity.
	{
		const collectedCells = await collectCapacity(indexer, addressToScript(fundingAccountAddress), outputCapacity - totalRecycledCapacity + ckbytesToShannons(61n));
		transaction = transaction.update("inputs", (i)=>i.concat(collectedCells.inputCells));
		addressesUsed.add(0);
	}

	// Determine the capacity of all input cells.
	const inputCapacity = transaction.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	// Create a change Cell for the remaining CKBytes.
	const changeCapacity = intToHex(inputCapacity - outputCapacity - TX_FEE);
	let change = {cellOutput: {capacity: changeCapacity, lock: addressToScript(fundingAccountAddress), type: null}, data: "0x"};
	transaction = transaction.update("outputs", (i)=>i.push(change));

	// Add in the witness placeholders.
	transaction = addDefaultWitnessPlaceholders(transaction);

	// Print the details of the transaction to the console.
	describeTransaction(transaction.toJS());

	// Prepare to sign the transaction.
	transaction = secp256k1Blake160.prepareSigningEntries(transaction);
	const signatures = [];
	const signingEntries = transaction.get("signingEntries").toArray();

	// Sign with the recycling addresses if they were used.
	accountsToRecycle.map((account, index) =>
	{
		const addressIndex = index + 1;
		if(addressesUsed.has(addressIndex))
		{
			const signature = signMessage(account.PRIVATE_KEY, signingEntries[signatures.length].message);
			signatures.push(signature);
		} 
	});

	// Sign with the genesis account if it was used.
	if(addressesUsed.has(0))
	{
		const signature = signMessage(fundingAccountPrivateKey, signingEntries[0].message);
		signatures.push(signature);
	}

	// Finalize the transaction.
	const signedTx = sealTransaction(transaction, signatures);

	// Send the transaction to the RPC node.
	// process.stdout.write("Setup Transaction Sent: ");
	const txid = await sendTransaction(NODE_URL, signedTx);
	// process.stdout.write(txid);

	// Wait for the transaction to confirm.
	process.stdout.write("Now setting up Cells for lab exercise. Please wait.");
	await waitForConfirmation(NODE_URL, txid, (_status)=>process.stdout.write("."), {recheckMs: 1_000});
	await indexerReady(indexer, (_indexerTip, _rpcTip)=>process.stdout.write("."));
	console.log("\n");
}

async function initializeLumosSkeleton(indexer)
{
	// Create a transaction skeleton.
	let skeleton = TransactionSkeleton();

	// Add the cell dep for the lock script.
	skeleton = skeleton.update("cellDeps", (cellDeps)=>cellDeps.push(locateCellDep({codeHash: DEFAULT_LOCK_HASH, hashType: "type"})));

	return skeleton;
}

export async function validateLab(skeleton)
{
	const tx = skeleton.toJS();
	const TX_FEE = 100_000n;

	if(tx.inputs.length < 3)
		throw new Error("This lab requires at least three input cells.");

	if(tx.outputs.length < 1)
		throw new Error("This lab requires at least one output Cell.");

	if(hexToInt(tx.outputs[0].cellOutput.capacity) !== ckbytesToShannons(300n) - TX_FEE)
		throw new Error("This lab requires output 0 to have a capacity of 300 CKBytes minus transaction fee of 0.001 CKB.")

	const inputCapacity = skeleton.inputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);
	const outputCapacity = skeleton.outputs.toArray().reduce((a, c)=>a+hexToInt(c.cellOutput.capacity), 0n);

	if(outputCapacity > inputCapacity)
		throw new Error("More capacity is required by the outputs than is available in the inputs.");

	if(TX_FEE !== 100_000n)
		throw new Error("This lab requires a TX Fee of exactly 0.001 CKBytes.");

	if(!isEqual(tx.outputs[0].cellOutput.lock, addressToScript(DANIEL_ADDRESS)))
	{
		throw new Error("This lab requires an output Cell with index 0 to have Daniel default lock.");
	}

	if(!tx.inputs.find(input => isEqual(input.cellOutput.lock, addressToScript(ALICE_ADDRESS))))
	{
		throw new Error("This lab requires an input Cell with Alice default lock.");
	}

	if(!tx.inputs.find(input => isEqual(input.cellOutput.lock, addressToScript(BOB_ADDRESS))))
	{
		throw new Error("This lab requires an input Cell with Bob default lock.");
	}

	if(!tx.inputs.find(input => isEqual(input.cellOutput.lock, addressToScript(CHARLIE_ADDRESS))))
	{
		throw new Error("This lab requires an input Cell with Charlie default lock.");
	}
}

export default {
	describeTransaction,
	getLiveCell,
	initializeLab,
	validateLab
};

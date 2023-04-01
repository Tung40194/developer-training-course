"use strict";

import fs from "fs";
import blake2b from "blake2b";
import secp256k1 from "secp256k1";
import {utils} from "@ckb-lumos/base";
const {ckbHash, computeScriptHash} = utils;
import {initializeConfig} from "@ckb-lumos/config-manager";
import {addressToScript, encodeToAddress} from "@ckb-lumos/helpers";
import {hexToUint8Array, uint8ArrayToHex} from "../lib/util.js";
const CONFIG = JSON.parse(fs.readFileSync("../config.json"));

// We initialize Lumos so it ready when we need to use some of its features.
initializeConfig(CONFIG);

// This is the private key for the first genesis account on the local development blockchain.
const PRIVATE_KEY = "0xd00c06bfd800d27397002dca6fb0993d5ba6399b4238b2f29ee9deb97593d2bc";
console.log(`Private Key:\t${PRIVATE_KEY} (32 bytes)`);

// This is the corresponding public key that is generated from the private key.
const publicKey = uint8ArrayToHex(secp256k1.publicKeyCreate(hexToUint8Array(PRIVATE_KEY)));
console.log(`Public Key:\t${publicKey} (33 bytes)`);

// This is the lock arg which is generated from the public key.
// const lockArg = uint8ArrayToHex(blake2b(32, null, null, new TextEncoder("utf-8").encode("ckb-default-hash")).update(hexToUint8Array(publicKey)).digest()).substr(0, 42); // This the plain Blake2b.
const lockArg = ckbHash(publicKey).substr(0, 42); // This uses Lumos' ckbHash() function.
console.log(`Lock Arg:\t${lockArg} (20 bytes)`);

// Here we construct a lock script using the default lock and the lock arg for our genesis account. 
const lockScript =
{
	codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", // This is the default lock script address for the local development blockchain.
	hashType: "type", // The default lock script always uses a value of "type".
	args: lockArg
};
const lines = JSON.stringify(lockScript, null, 2).split("\n");
console.log("Lock Script:\t{");
console.log("            \t" + lines[1]);
console.log("            \t" + lines[2]);
console.log("            \t" + lines[3]);
console.log("            \t}");

// This is the lock hash which is computed from the lock script. 
const lockHash = computeScriptHash(lockScript);
console.log(`Lock Hash:\t${lockHash} (32 bytes)`);

// This is the testnet address which is computed from the lock script. In a production environment, this function would automatically generate a Mainnet address.
const address = encodeToAddress(lockScript);
console.log(`Address:\t${address} (Testnet)`);

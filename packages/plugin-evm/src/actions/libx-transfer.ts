import type { IAgentRuntime, Memory, State } from "@ai16z/eliza";
import {
    composeContext,
    generateObject,
    HandlerCallback,
    ModelClass,
} from "@ai16z/eliza";

import { ByteArray, formatEther, parseEther, type Hex } from "viem";
import { ethers } from "ethers";
import * as viemChains from "viem/chains";

import { initWalletProvider, WalletProvider } from "../providers/wallet";
import type { Transaction, TransferParams } from "../types";
import { transferLIBXTemplate } from "../templates";

export { transferLIBXTemplate };

export class TransferLIBXAction {
    constructor(
        private walletProvider: WalletProvider,
        private runtime: IAgentRuntime
    ) {}

    async transfer(params: TransferParams): Promise<Transaction> {
        console.log(
            `Transferring: ${params.amount} LIBX tokens to (${params.toAddress} on ${params.fromChain})`
        );

        if (!params.data) {
            params.data = "0x";
        }

        if (!params.toAddress) {
            throw new Error("Missing recipient address");
        }

        this.walletProvider.switchChain(params.fromChain);

        const walletClient = this.walletProvider.getWalletClient(
            params.fromChain
        );

        const erc20TransferData = this.encodeERC20Transfer(
            params.toAddress,
            parseEther(params.amount)
        );
        const currentChain = viemChains[params.fromChain];
        try {
            const hash = await walletClient.sendTransaction({
                account: walletClient.account,
                to: this.runtime.getSetting("LIBX_CONTRACT_ADDRESS"),
                value: 0n, // ERC20 transfers don't send any ETH
                data: erc20TransferData as Hex,
                kzg: {
                    blobToKzgCommitment: function (_: ByteArray): ByteArray {
                        throw new Error("Function not implemented.");
                    },
                    computeBlobKzgProof: function (
                        _blob: ByteArray,
                        _commitment: ByteArray
                    ): ByteArray {
                        throw new Error("Function not implemented.");
                    },
                },
                chain: undefined,
            });

            return {
                hash: `${currentChain.blockExplorers.default.url}/tx/${hash}`,
                from: walletClient.account.address,
                to: params.toAddress,
                value: parseEther(params.amount),
                data: erc20TransferData as Hex,
            };
        } catch (error) {
            throw new Error(`Transfer failed: ${error.message}`);
        }
    }

    private encodeERC20Transfer(to: string, amount: bigint): string {
        const abi = ["function transfer(address to, uint256 amount)"];
        const iface = new ethers.Interface(abi);
        return iface.encodeFunctionData("transfer", [to, amount]);
    }
}

const buildTransferDetails = async (
    state: State,
    runtime: IAgentRuntime,
    wp: WalletProvider
): Promise<TransferParams> => {
    const context = composeContext({
        state,
        template: transferLIBXTemplate,
    });

    const chains = Object.keys(wp.chains);
    const contextWithChains = context.replace(
        "SUPPORTED_CHAINS",
        chains.map((item) => `"${item}"`).join("|")
    );

    const transferDetails = (await generateObject({
        runtime,
        context: contextWithChains,
        modelClass: ModelClass.SMALL,
    })) as TransferParams;

    const existingChain = wp.chains[transferDetails.fromChain];
    if (!existingChain) {
        throw new Error(
            "The chain " +
                transferDetails.fromChain +
                " not configured yet. Add the chain or choose one from configured: " +
                chains.toString()
        );
    }

    return transferDetails;
};

export const transferLIBXAction = {
    name: "TRANSFER_LIBX",
    description:
        "Transfer tokens between addresses on the same chain. Cannot transfer native token such as ETH. This action only can be used after the user has given a valid contribution to the LibriX",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        console.log("Transfer LIBX action handler called");
        const walletProvider = initWalletProvider(runtime);
        const action = new TransferLIBXAction(walletProvider, runtime);
        // Compose transfer context
        const paramOptions = await buildTransferDetails(
            state,
            runtime,
            walletProvider
        );

        try {
            const transferResp = await action.transfer(paramOptions);
            if (callback) {
                callback({
                    text: `Successfully transferred ${paramOptions.amount} LIBX tokens to ${paramOptions.toAddress}\nTransaction Hash: ${transferResp.hash}`,
                    content: {
                        success: true,
                        hash: transferResp.hash,
                        amount: formatEther(transferResp.value),
                        recipient: transferResp.to,
                        chain: paramOptions.fromChain,
                    },
                });
            }
            return true;
        } catch (error) {
            console.error("Error during LIBX token transfer:", error);
            if (callback) {
                callback({
                    text: `Error transferring LIBX tokens: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    template: transferLIBXTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        const libXAddress = runtime.getSetting("LIBX_CONTRACT_ADDRESS");
        return (
            typeof privateKey === "string" &&
            privateKey.startsWith("0x") &&
            typeof libXAddress === "string" &&
            libXAddress.startsWith("0x")
        );
    },
    examples: [
        [
            {
                user: "assistant",
                content: {
                    text: "I'll help you transfer 1 LIBX to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                    action: "SEND_TOKENS",
                },
            },
            {
                user: "user",
                content: {
                    text: "Transfer 1 LIBX to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                    action: "SEND_TOKENS",
                },
            },
        ],
    ],
    similes: [
        "SEND_TOKENS",
        "TOKEN_TRANSFER",
        "MOVE_TOKENS",
        "SEND_LIBX_TOKENS",
        "LIBX_TOKEN_TRANSFER",
        "MOVE_LIBX_TOKENS",
    ],
};

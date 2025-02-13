import type { IAgentRuntime, Memory, State } from "@ai16z/eliza";
import {
    composeContext,
    elizaLogger,
    generateObject,
    HandlerCallback,
    ModelClass,
} from "@ai16z/eliza";

import { ethers } from "ethers";

import { initWalletProvider, WalletProvider } from "../providers/wallet";
import type { BalanceOfParams } from "../types";
import { balanceOfLIBXTemplate } from "../templates";

export { balanceOfLIBXTemplate };

export class BalanceOfLIBXAction {
    constructor(
        private walletProvider: WalletProvider,
        private runtime: IAgentRuntime
    ) {}

    async balanceOf(params: BalanceOfParams): Promise<string> {
        elizaLogger.log(
            `Fetching balance of LIBX tokens for address: ${params.address} on ${params.chain}`
        );

        this.walletProvider.switchChain(params.chain);
        const contractAddress = this.runtime.getSetting(
            "LIBX_CONTRACT_ADDRESS"
        );
        const abi = [
            "function balanceOf(address owner) view returns (uint256)",
        ];
        const provider = this.walletProvider.getProvider(params.chain);
        const contract = new ethers.Contract(contractAddress, abi, provider);

        try {
            const balance = await contract.balanceOf(params.address);
            return ethers.formatUnits(balance, 18);
        } catch (error) {
            throw new Error(`Failed to fetch balance: ${error.message}`);
        }
    }
}

const buildBalanceOfDetails = async (
    state: State,
    runtime: IAgentRuntime,
    wp: WalletProvider
): Promise<BalanceOfParams> => {
    const context = composeContext({
        state,
        template: balanceOfLIBXTemplate,
    });

    const chains = Object.keys(wp.chains);

    const contextWithChains = context.replace(
        "SUPPORTED_CHAINS",
        chains.map((item) => `"${item}"`).join("|")
    );

    const balanceOfDetails = (await generateObject({
        runtime,
        context: contextWithChains,
        modelClass: ModelClass.SMALL,
    })) as BalanceOfParams;

    const existingChain = wp.chains[balanceOfDetails.chain];

    if (!existingChain) {
        throw new Error(
            "The chain " +
                balanceOfDetails.chain +
                " not configured yet. Add the chain or choose one from configured: " +
                chains.toString()
        );
    }

    return balanceOfDetails;
};

export const balanceOfLIBXAction = {
    name: "BALANCE_OF_LIBX",
    description:
        "Fetch the balance of LIBX tokens for a given address on a specified chain",
    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Balance of LIBX action handler called");
        const walletProvider = initWalletProvider(runtime);
        const action = new BalanceOfLIBXAction(walletProvider, runtime);

        // Compose balanceOf context
        const paramOptions = await buildBalanceOfDetails(
            state,
            runtime,
            walletProvider
        );

        try {
            const balance = await action.balanceOf(paramOptions);
            if (callback) {
                callback({
                    text: `The balance of LIBX tokens for address ${paramOptions.address} is ${balance}`,
                    content: {
                        success: true,
                        balance,
                        address: paramOptions.address,
                        chain: paramOptions.chain,
                    },
                });
            }
            return true;
        } catch (error) {
            console.error("Error fetching LIBX token balance:", error);
            if (callback) {
                callback({
                    text: `Error fetching LIBX token balance: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    template: balanceOfLIBXTemplate,
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
                    text: "I'll help you check the balance of LIBX tokens for 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                    action: "CHECK_LIBX_BALANCE",
                },
            },
            {
                user: "user",
                content: {
                    text: "Check the balance of LIBX tokens for 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                    action: "CHECK_LIBX_BALANCE",
                },
            },
        ],
    ],
    similes: ["CHECK_LIBX_BALANCE", "LIBX_TOKEN_BALANCE", "GET_LIBX_BALANCE"],
};

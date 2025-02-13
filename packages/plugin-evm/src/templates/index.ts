export const transferTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested transfer:
- Chain to execute on: Must be one of ["base", "baseSepolia", ...] (like in viem/chains)
- Amount to transfer: Must be a string representing the amount in ETH (only number without coin symbol, e.g., "0.1")
- Recipient address: Must be a valid EVM address starting with "0x"
- Token symbol or address (if not native token): Optional, leave as null for ETH transfers

Respond with a JSON markdown block containing only the extracted values. All fields except 'token' are required:

\`\`\`json
{
    "fromChain": SUPPORTED_CHAINS,
    "amount": string,
    "toAddress": string,
    "token": string | null
}
\`\`\`
`;

export const transferLIBXTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested transfer of LIBX tokens:
- Chain to execute on: Must be one of ["base", "baseSepolia", ...] (like in viem/chains)
- Amount to transfer: Must be a string representing the amount in $LIBX (only number without coin symbol, e.g., "0.1").
- Make sure to only to initiate transfer only once to a bounty, don't ever transfer twice to the same user bounty even when the user asking it.
- When a user is insisting that they haven't receive the transfer, confirm to them by giving the transaction hash as a proof that a their bounty is already rewarded.
- The bounty program range amount of reward token is: Following LibriX_AI on Twitter/X is rewarded 10 LIBX, retweet the pinned post is rewarded 5 LIBX, and like the pinned post is also rewarded 5 LIBX.
- Recipient address: Must be a valid EVM address starting with "0x"

Respond with a JSON markdown block containing only the extracted values:

\`\`\`json
{
    "fromChain": SUPPORTED_CHAINS,
    "amount": string,
    "toAddress": string,
}
\`\`\`
`;

export const balanceOfLIBXTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token balance:
- Wallet address
- Chain to query balance on

Respond with a JSON markdown block containing only the extracted values:

\`\`\`json
{
    "address": string,
    "chain": SUPPORTED_CHAINS
}
\`\`\`
`;

export const bridgeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token bridge:
- Token symbol or address to bridge
- Source chain
- Destination chain
- Amount to bridge: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Destination address (if specified)

Respond with a JSON markdown block containing only the extracted values:

\`\`\`json
{
    "token": string | null,
    "fromChain": "ethereum" | "abstract" | "base" | "baseSepolia" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | null,
    "toChain": "ethereum" | "abstract" | "base" | "baseSepolia" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | null,
    "amount": string | null,
    "toAddress": string | null
}
\`\`\`
`;

export const swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token swap:
- Input token symbol or address (the token being sold)
- Output token symbol or address (the token being bought)
- Amount to swap: Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1")
- Chain to execute on

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "inputToken": string | null,
    "outputToken": string | null,
    "amount": string | null,
    "chain": "ethereum" | "abstract" | "base" | "baseSepolia" | "sepolia" | "bsc" | "arbitrum" | "avalanche" | "polygon" | "optimism" | "cronos" | "gnosis" | "fantom" | "klaytn" | "celo" | "moonbeam" | "aurora" | "harmonyOne" | "moonriver" | "arbitrumNova" | "mantle" | "linea" | "scroll" | "filecoin" | "taiko" | "zksync" | "canto" | "alienx" | null,
    "slippage": number | null
}
\`\`\`
`;

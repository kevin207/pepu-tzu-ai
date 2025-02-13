import { composeContext } from "@ai16z/eliza";
import { generateObjectArray } from "@ai16z/eliza";
import { MemoryManager } from "@ai16z/eliza";
import {
    ActionExample,
    IAgentRuntime,
    Memory,
    ModelClass,
    Evaluator,
} from "@ai16z/eliza";

// TODO:
const factsTemplate =
    // {{actors}}
    `TASK: <>

    <...>

Response should be a JSON object array inside a JSON markdown block. Correct response format:
\`\`\`json
[
  {"claim": string, "type": enum<fact|opinion|status>, in_bio: boolean, already_known: boolean },
  {"claim": string, "type": enum<fact|opinion|status>, in_bio: boolean, already_known: boolean },
  ...
]
\`\`\`
    `;

export const contributionEvaluator: Evaluator = {
    name: "CONTRIBUTION_EVALUATOR",
    description:
        "reviews contributions made by users and determines the distribution of LIBX token rewards. By analyzing the quality, feasibility, and impact of ideas shared",
    similes: [
        "CONTRIBUTION_CHECK",
        "USER_CONTRIBUTION_EVALUATOR",
        "CONTRIBUTION_REVIEW",
    ],
    examples: [
        {
            context:
                "User gives ideas and actionable strategies on one or more of these topics: 1) Marketing Ideas to Grow the LibriX Community 2) Marketing Ideas to Attract AI Agent Engineering Talent 3) Ideas to Promote the Upcoming LIBX Token Pre-Sale",
            messages: [
                {
                    user: "User",
                    content: { text: "<>" },
                },
                { user: "Agent", content: { text: "<>" } },
            ],
            outcome: "<>",
        },
    ],
    handler: async (runtime, message, state, options, callback) => {
        // Custom logic for the evaluator
        console.log("Custom evaluator handler executed.");
        return true;
    },
    validate: async (runtime, message, state) => {
        // Validation logic to determine if the evaluator should run
        return message.content.text.includes("weather");
    },
};

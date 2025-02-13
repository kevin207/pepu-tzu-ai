[@ai16z/eliza v0.1.5-alpha.5](../index.md) / GenerationOptions

# Interface: GenerationOptions

Configuration options for generating objects with a model.

## Properties

### runtime

> **runtime**: [`IAgentRuntime`](IAgentRuntime.md)

#### Defined in

[packages/core/src/generation.ts:1073](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1073)

***

### context

> **context**: `string`

#### Defined in

[packages/core/src/generation.ts:1074](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1074)

***

### modelClass

> **modelClass**: [`ModelClass`](../enumerations/ModelClass.md)

#### Defined in

[packages/core/src/generation.ts:1075](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1075)

***

### schema?

> `optional` **schema**: `ZodType`\<`any`, `ZodTypeDef`, `any`\>

#### Defined in

[packages/core/src/generation.ts:1076](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1076)

***

### schemaName?

> `optional` **schemaName**: `string`

#### Defined in

[packages/core/src/generation.ts:1077](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1077)

***

### schemaDescription?

> `optional` **schemaDescription**: `string`

#### Defined in

[packages/core/src/generation.ts:1078](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1078)

***

### stop?

> `optional` **stop**: `string`[]

#### Defined in

[packages/core/src/generation.ts:1079](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1079)

***

### mode?

> `optional` **mode**: `"auto"` \| `"json"` \| `"tool"`

#### Defined in

[packages/core/src/generation.ts:1080](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1080)

***

### experimental\_providerMetadata?

> `optional` **experimental\_providerMetadata**: `Record`\<`string`, `unknown`\>

#### Defined in

[packages/core/src/generation.ts:1081](https://github.com/LibriX-Nation/LibriX-AI-Agent/blob/main/packages/core/src/generation.ts#L1081)

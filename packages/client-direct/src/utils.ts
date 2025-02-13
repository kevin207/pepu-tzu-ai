import { UUID } from "@ai16z/eliza";
import express from "express";
import { z } from "zod";

interface UUIDParams {
    agentId: UUID;
    roomId?: UUID;
    chatId?: UUID;
}

export const uuidSchema = z.string().uuid() as z.ZodType<UUID>;

export const validateUuid = (value: unknown): UUID | null => {
    const result = uuidSchema.safeParse(value);
    return result.success ? result.data : null;
};

export const validateUUIDWithResponse = (
    value: unknown,
    res: express.Response,
    field: string
): UUID | null => {
    const result = uuidSchema.safeParse(value);
    if (!result.success) {
        if (!res.headersSent) {
            res.status(400).json({
                error: `Invalid ${field} format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
            });
        }
        return null;
    }
    return result.data;
};

export const validateUUIDParams = (
    params: { agentId: string; roomId?: string; chatId?: string },
    res: express.Response
): UUIDParams | null => {
    const agentId = validateUuid(params.agentId);
    if (!agentId) {
        res.status(400).json({
            error: "Invalid AgentId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
        return null;
    }

    if (params.roomId) {
        const roomId = validateUuid(params.roomId);
        if (!roomId) {
            res.status(400).json({
                error: "Invalid RoomId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }

        return { agentId, roomId };
    }

    return { agentId };
};

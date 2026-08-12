import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import type { SQLiteDatabase } from 'expo-sqlite';

import { invokeEdgeFunction } from './supabase';
import { enqueueUpsert, syncPendingChanges } from './sync-queue';
import type { AiMessage, DeterministicPlanBrief } from './types';

type WellnessChatMode = 'chat' | 'plan_explanation';

type PendingRequest = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantSequence: number;
  mode: WellnessChatMode;
  planBrief: DeterministicPlanBrief;
};

type WellnessChatResponse = {
  message: {
    id: string;
    conversationId: string;
    sequence: number;
    content: string;
    createdAt: string;
    model: string | null;
  };
};

export async function sendWellnessMessage(
  db: SQLiteDatabase,
  content: string,
  planBrief: DeterministicPlanBrief,
  mode: WellnessChatMode = 'chat',
): Promise<AiMessage> {
  const clean = content.trim();
  if (!clean) throw new Error('Write a question or choose a prompt first.');
  if (clean.length > 2_000) throw new Error('Keep the message under 2,000 characters.');
  await assertAiReady(db);
  const unresolved = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM ai_messages
     WHERE role = 'user' AND local_status != 'complete' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  );
  if (unresolved) throw new Error('Retry the unfinished question before starting a new one.');
  const request = await createPendingRequest(db, clean, planBrief, mode);
  return deliverPendingRequest(db, request);
}

export async function retryWellnessMessage(
  db: SQLiteDatabase,
  userMessageId: string,
): Promise<AiMessage> {
  await assertAiReady(db);
  const row = await db.getFirstAsync<{
    conversation_id: string;
    sequence: number;
    metadata: string;
  }>(
    `SELECT conversation_id, sequence, metadata
     FROM ai_messages WHERE id = ? AND role = 'user' AND deleted_at IS NULL`,
    [userMessageId],
  );
  if (!row) throw new Error('That cached message is no longer available.');
  const metadata = JSON.parse(row.metadata) as {
    assistant_message_id?: string;
    mode?: WellnessChatMode;
    plan_brief?: DeterministicPlanBrief;
  };
  if (!metadata.assistant_message_id || !metadata.plan_brief) {
    throw new Error('This older message cannot be retried. Ask it again instead.');
  }
  await db.runAsync(`UPDATE ai_messages SET local_status = 'pending' WHERE id = ?`, [userMessageId]);
  return deliverPendingRequest(db, {
    conversationId: row.conversation_id,
    userMessageId,
    assistantMessageId: metadata.assistant_message_id,
    assistantSequence: row.sequence + 1,
    mode: metadata.mode ?? 'chat',
    planBrief: metadata.plan_brief,
  });
}

async function assertAiReady(db: SQLiteDatabase): Promise<void> {
  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) {
    throw new Error('AI needs a connection. Your check-ins and previous guidance still work offline.');
  }
  const profile = await db.getFirstAsync<{
    ai_data_consent: number;
    medical_disclaimer_acknowledged_at: string | null;
  }>(
    `SELECT ai_data_consent, medical_disclaimer_acknowledged_at
     FROM user_profile WHERE id = 'current'`,
  );
  if (!profile?.ai_data_consent) {
    throw new Error('Turn on AI data consent in your profile before requesting guidance.');
  }
  if (!profile.medical_disclaimer_acknowledged_at) {
    throw new Error('Acknowledge the health guidance notice before using AI.');
  }
}

async function createPendingRequest(
  db: SQLiteDatabase,
  content: string,
  planBrief: DeterministicPlanBrief,
  mode: WellnessChatMode,
): Promise<PendingRequest> {
  let conversationId = '';
  let userMessageId = '';
  let assistantMessageId = '';
  let assistantSequence = 0;
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM ai_conversations
       WHERE purpose = 'wellness' AND status = 'active' AND deleted_at IS NULL
       ORDER BY last_message_at DESC, created_at DESC LIMIT 1`,
    );
    conversationId = existing?.id ?? Crypto.randomUUID();
    const sequenceRow = await db.getFirstAsync<{ next_sequence: number }>(
      `SELECT COALESCE(MAX(sequence), -1) + 1 AS next_sequence
       FROM ai_messages WHERE conversation_id = ?`,
      [conversationId],
    );
    const userSequence = sequenceRow?.next_sequence ?? 0;
    assistantSequence = userSequence + 1;
    userMessageId = Crypto.randomUUID();
    assistantMessageId = Crypto.randomUUID();
    const title = content.length > 56 ? `${content.slice(0, 53)}...` : content;
    const conversationPayload = {
      id: conversationId,
      purpose: 'wellness',
      title,
      status: 'active',
      last_message_at: now,
      created_at: now,
      client_updated_at: now,
      deleted_at: null,
    };
    if (!existing) {
      await db.runAsync(
        `INSERT INTO ai_conversations (
          id, purpose, title, status, last_message_at, created_at, updated_at,
          client_updated_at
        ) VALUES (?, 'wellness', ?, 'active', ?, ?, ?, ?)`,
        [conversationId, title, now, now, now, now],
      );
    } else {
      await db.runAsync(
        `UPDATE ai_conversations
         SET last_message_at = ?, updated_at = ?, client_updated_at = ?
         WHERE id = ?`,
        [now, now, now, conversationId],
      );
    }
    await enqueueUpsert(db, 'ai_conversations', conversationId, conversationPayload);

    const metadata = {
      assistant_message_id: assistantMessageId,
      mode,
      plan_brief: planBrief,
    };
    const messagePayload = {
      id: userMessageId,
      conversation_id: conversationId,
      sequence: userSequence,
      role: 'user',
      content,
      structured_content: {},
      metadata: {},
      model: null,
      provider_message_id: null,
      created_at: now,
      client_updated_at: now,
      deleted_at: null,
    };
    await db.runAsync(
      `INSERT INTO ai_messages (
        id, conversation_id, sequence, role, content, structured_content,
        metadata, local_status, created_at, updated_at, client_updated_at
      ) VALUES (?, ?, ?, 'user', ?, '{}', ?, 'pending', ?, ?, ?)`,
      [userMessageId, conversationId, userSequence, content, JSON.stringify(metadata), now, now, now],
    );
    await enqueueUpsert(db, 'ai_messages', userMessageId, messagePayload);
  });

  return { conversationId, userMessageId, assistantMessageId, assistantSequence, mode, planBrief };
}

async function deliverPendingRequest(
  db: SQLiteDatabase,
  request: PendingRequest,
): Promise<AiMessage> {
  try {
    const syncResult = await syncPendingChanges(db);
    const stillQueued = await db.getFirstAsync<{ pending: number }>(
      `SELECT 1 AS pending FROM sync_queue
       WHERE table_name = 'ai_messages' AND entity_id = ?`,
      [request.userMessageId],
    );
    if (syncResult.state !== 'synced' || stillQueued) {
      throw new Error(
        syncResult.state === 'partial'
          ? `Sync the latest local data before asking AI: ${syncResult.error}`
          : 'Sign in and sync your latest local data before asking AI.',
      );
    }

    const response = await invokeEdgeFunction<WellnessChatResponse>('wellness-chat', {
      conversationId: request.conversationId,
      userMessageId: request.userMessageId,
      assistantMessageId: request.assistantMessageId,
      assistantSequence: request.assistantSequence,
      mode: request.mode,
      planBrief: request.planBrief,
    });
    const message = response.message;
    const local: AiMessage = {
      id: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
      role: 'assistant',
      content: message.content,
      createdAt: message.createdAt,
      localStatus: 'complete',
      metadata: { mode: request.mode },
    };
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO ai_messages (
          id, conversation_id, sequence, role, content, structured_content,
          metadata, model, local_status, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, 'assistant', ?, '{}', ?, ?, 'complete', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          model = excluded.model,
          local_status = 'complete',
          updated_at = excluded.updated_at,
          client_updated_at = excluded.client_updated_at`,
        [
          message.id,
          message.conversationId,
          message.sequence,
          message.content,
          JSON.stringify(local.metadata),
          message.model,
          message.createdAt,
          now,
          now,
        ],
      );
      await db.runAsync(`UPDATE ai_messages SET local_status = 'complete' WHERE id = ?`, [request.userMessageId]);
      await db.runAsync(
        `UPDATE ai_conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`,
        [message.createdAt, now, request.conversationId],
      );
    });
    return local;
  } catch (error) {
    await db.runAsync(`UPDATE ai_messages SET local_status = 'failed' WHERE id = ?`, [request.userMessageId]);
    throw error;
  }
}

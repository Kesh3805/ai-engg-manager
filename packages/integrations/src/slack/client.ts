import { WebClient } from '@slack/web-api';

export function getSlackClient(botToken: string): WebClient {
  return new WebClient(botToken);
}

export async function fetchChannelHistory(client: WebClient, channelId: string, oldest: string) {
  const result = await client.conversations.history({ channel: channelId, oldest, limit: 200 });
  return result.messages ?? [];
}

/** Post a message; returns ts. Used for staging-channel notifications only. */
export async function postSlackMessage(client: WebClient, channelId: string, text: string): Promise<string | null> {
  const result = await client.chat.postMessage({ channel: channelId, text });
  return result.ts ?? null;
}

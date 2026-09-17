export enum EntryType {
  BUTTON = 'BUTTON',
  COMMENT = 'COMMENT'
}

export enum LotteryStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DRAWING = 'DRAWING',
  ENDED = 'ENDED'
}

export type DrawMode = 'MANUAL' | 'AUTO';

export interface PrizeTier {
  id: string;
  name: string;
  count: number;
}

export interface Participant {
  id: string;
  username: string;
  firstName: string;
  lastName?: string;
  chatId: string;
  joinTime: string;
  accountAge: string;
  hasJoinedChannel: boolean;
  comment?: string;
}

export interface Winner extends Participant {
  prizeName: string;
  claimStatus?: 'PENDING' | 'CLAIMED';
}

export interface DesignatedWinnerInput {
  participantId: string;
  prizeName: string;
}

export interface LotteryConfig {
  id: string;
  internalName: string;
  description: string;
  imageUrl?: string;
  entryType: EntryType;
  buttonText?: string;

  requiredChannelId?: string;
  requiredGroupId?: string;
  targetChatId: string;
  targetTopicId?: string;
  allowedChatIds?: string[];

  drawMode: DrawMode;
  startTime: string;
  endTime: string;
  autoDrawTime?: string;

  prizes: PrizeTier[];

  status: LotteryStatus;
  telegramMessageId?: number;
  participantCount?: number;
  participants: Participant[];
  winners: Winner[];
  designatedWinners?: DesignatedWinnerInput[];
  announcementTemplate?: string;
}

export interface BotConfig {
  id: number;
  username: string;
  firstName: string;
}

export interface BotMessageTemplates {
  msg_success_join: string;
  msg_already_joined: string;
  msg_not_started: string;
  msg_ended: string;
  msg_entries_closed: string;
  msg_og_only: string;
  msg_must_join_group_channel: string;
  msg_rate_limit: string;
  msg_join_failed: string;
}

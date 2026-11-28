/**
 * The messages module's public entry (docs/architecture/messages.md): the outbox every message Valo means to
 * send waits in, the dispatcher that offers each to a sender, the senders, the messages' words, what the
 * email provider reports about a message it took, and the message a day's notices owe a workspace. Code
 * outside artifacts/api-server/src/modules/messages imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 */
export { messagesReady, queueMessage } from "./valo-messages";
export { MESSAGE_ATTEMPT_LIMIT, MESSAGE_KINDS, messageRetryAt, type MessageKind } from "./message-policy";
export { dispatchDueMessages, dispatchMessage } from "./valo-message-dispatcher";
export { runMessagesJob } from "./messages-job";
export { noticeDigestsReady, oweNoticeDigests } from "./valo-notice-digests";
export { listWorkspaceMessages } from "./valo-message-log";
export {
  DELIVERIES,
  emailWebhookKeys,
  resendEvents,
  type Delivery,
  type EmailEventSource,
  type EmailReport,
} from "./email-events";
export { deliveriesOf, emailEventsReady, recordDeliveryReports, recordEmailEvent } from "./valo-email-events";
export { addressSuppressed, SUPPRESSION_LASTS_MS } from "./valo-email-suppression";
export {
  readUnsubscribeToken,
  unsubscribeToken,
  UNSUBSCRIBE_CONSENTS,
  UNSUBSCRIBE_TOKEN_MAX,
  type UnsubscribeConsent,
  type UnsubscribeLink,
} from "./unsubscribe-token";
export {
  STAND_IN_SENDER,
  configuredMessageSender,
  standInSender,
  type KeptMessage,
  type MessageSender,
  type OutgoingMessage,
  type SenderAnswer,
} from "./message-sender";

/**
 * The messages module's public entry (docs/architecture/messages.md): the outbox every message Valo means to
 * send waits in, the dispatcher that offers each to a sender, the senders, the messages' words, and what
 * the email provider reports about a message it took. Code
 * outside artifacts/api-server/src/modules/messages imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 */
export { messagesReady, queueMessage } from "./valo-messages";
export { MESSAGE_ATTEMPT_LIMIT, MESSAGE_KINDS, messageRetryAt, type MessageKind } from "./message-policy";
export { dispatchDueMessages, dispatchMessage } from "./valo-message-dispatcher";
export { runMessagesJob } from "./messages-job";
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
export {
  STAND_IN_SENDER,
  configuredMessageSender,
  standInSender,
  type KeptMessage,
  type MessageSender,
  type OutgoingMessage,
} from "./message-sender";

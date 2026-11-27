/**
 * The messages module's public entry (docs/architecture/messages.md): the outbox every message Valo means to
 * send waits in, the dispatcher that offers each to a sender, the senders and the messages' words. Code
 * outside artifacts/api-server/src/modules/messages imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 */
export { messagesReady, queueMessage } from "./valo-messages";
export { MESSAGE_ATTEMPT_LIMIT, MESSAGE_KINDS, messageRetryAt, type MessageKind } from "./message-policy";
export { dispatchDueMessages, dispatchMessage } from "./valo-message-dispatcher";
export {
  configuredMessageSender,
  standInSender,
  type KeptMessage,
  type MessageSender,
  type OutgoingMessage,
} from "./message-sender";

/**
 * `@jects/elements/chatbot` — the `<jects-chatbot>` custom element only.
 * Importing this entry pulls ONLY `@jects/chatbot` plus the engine-free shared factory.
 */
import { Chatbot, type ChatbotConfig, type ChatbotEvents } from '@jects/chatbot';
import { createComponent, defineElements, type JectsElementDefinition } from './shared.js';

export const JectsChatbotElement = createComponent<Chatbot, ChatbotConfig, ChatbotEvents>(Chatbot);

/** The `<jects-chatbot>` tag paired with its element class. */
export const chatbotElementDefinition: JectsElementDefinition = {
  tag: 'jects-chatbot',
  ctor: JectsChatbotElement,
};

/** Define `<jects-chatbot>` into a registry (defaults to the global `customElements`). Idempotent. */
export function registerChatbot(target?: CustomElementRegistry): void {
  defineElements([chatbotElementDefinition], target);
}

export {
  createComponent,
  type JectsElement,
  type JectsElementConstructor,
  type JectsElementDefinition,
} from './shared.js';
export type { ChatbotConfig, ChatbotEvents };
